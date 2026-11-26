import unittest
from types import SimpleNamespace

from bridge import Mt5Bridge, candle_payload, resolve_broker_symbol


class IndexedRow:
    def __init__(self, **values):
        self.values = values

    def __getitem__(self, key):
        return self.values[key]


class RetryingClient:
    def __init__(self):
        self.fail_next_market_data = True

    def post(self, endpoint, payload):
        if endpoint.endswith("/market-data") and self.fail_next_market_data:
            self.fail_next_market_data = False
            raise RuntimeError("temporary network failure")
        return {"accepted": True}


class BridgeNormalizationTests(unittest.TestCase):
    def test_repeated_sync_keeps_account_identity_for_market_data(self):
        requests = []

        class Client:
            def post(self, endpoint, payload):
                requests.append(endpoint)
                if endpoint.endswith("/orders/commands"):
                    return {"accepted": True, "preflight": [], "execute": [], "reconcile": []}
                return {"accepted": True}

        bridge = Mt5Bridge(
            SimpleNamespace(
                account_info=lambda: SimpleNamespace(login=123, server="Demo"),
                version=lambda: (5, 0, 0),
            ),
            Client(),
            clock_ms=lambda: 1_000_000,
        )
        bridge.connected = True
        bridge.last_account_identity = ("123", "Demo")
        bridge.symbols = {"EURUSD": {"brokerSymbol": "EURUSD"}}
        bridge.timeframes = []
        bridge._account_payload = lambda: {
            "terminalVersion": "5.0.0",
            "account": {"login": "123", "server": "Demo"},
        }
        bridge._tick_payload = lambda _symbol: {
            "brokerSymbol": "EURUSD",
            "sourceTickId": "tick-1",
            "timeMs": 1,
            "bid": 1.0,
            "ask": 1.1,
        }
        bridge._rates = lambda *_args: []

        bridge.synchronize()
        bridge.synchronize()

        self.assertEqual(requests.count("/api/mt5/bridge/market-data"), 2)

    def test_market_data_is_sent_in_bounded_batches(self):
        posts = []
        client = SimpleNamespace(post=lambda endpoint, payload: posts.append((endpoint, payload)))
        bridge = Mt5Bridge(SimpleNamespace(), client)
        candles = [
            {"brokerSymbol": "EURUSD", "timeframe": "M1", "openTimeMs": index}
            for index in range(1201)
        ]

        bridge._send_market_data({"login": "123", "server": "Demo"}, [], candles)

        self.assertEqual([len(payload["candles"]) for _, payload in posts], [500, 500, 201])

    def test_close_position_uses_live_quote_without_open_order_protection(self):
        mt5 = SimpleNamespace(
            symbol_info_tick=lambda _symbol: SimpleNamespace(
                bid=1.1,
                ask=1.1002,
                time_msc=999_900,
            ),
            symbol_info=lambda _symbol: SimpleNamespace(
                point=0.0001,
                digits=4,
                trade_stops_level=5,
            ),
        )
        bridge = Mt5Bridge(mt5, object(), clock_ms=lambda: 1_000_000)
        price, bid, ask = bridge._current_order_price({
            "operation": "close_position",
            "brokerSymbol": "EURUSD",
            "side": "sell",
            "orderType": None,
            "payload": {"maxSpreadPoints": 30},
        })
        self.assertEqual((price, bid, ask), (1.1, 1.1, 1.1002))

    def test_tick_and_execution_freshness_normalize_broker_server_time(self):
        now_ms = 1_000_000
        server_offset_ms = 7_200_000
        bridge = Mt5Bridge(
            SimpleNamespace(
                symbol_info_tick=lambda _symbol: SimpleNamespace(
                    bid=1.1,
                    ask=1.1002,
                    time_msc=now_ms + server_offset_ms,
                    last=0,
                    volume=1,
                    flags=0,
                ),
            ),
            object(),
            server_utc_offset_seconds=7200,
            clock_ms=lambda: now_ms,
        )

        self.assertEqual(bridge._tick_payload("EURUSD")["timeMs"], now_ms)

        stale_bridge = Mt5Bridge(
            SimpleNamespace(
                symbol_info_tick=lambda _symbol: SimpleNamespace(
                    bid=1.1,
                    ask=1.1002,
                    time_msc=now_ms + server_offset_ms - 16_000,
                ),
                symbol_info=lambda _symbol: SimpleNamespace(
                    point=0.0001,
                    digits=4,
                    trade_stops_level=5,
                ),
            ),
            object(),
            server_utc_offset_seconds=7200,
            clock_ms=lambda: now_ms,
        )
        with self.assertRaisesRegex(RuntimeError, "stale"):
            stale_bridge._current_order_price({
                "operation": "close_position",
                "brokerSymbol": "EURUSD",
                "side": "sell",
                "orderType": None,
                "payload": {"maxSpreadPoints": 30},
            })

    def test_order_comment_is_ascii_and_shorter_than_mt5_comment_limit(self):
        bridge = Mt5Bridge(SimpleNamespace(), object())
        comment = bridge._order_comment("0ec16d79-87dc-49bf-9480-8d679f53b4ba")

        self.assertEqual(comment, "AXYL0ec16d7987dc49bf9480")
        self.assertTrue(comment.isascii())
        self.assertLessEqual(len(comment), 24)

    def test_confirmed_order_result_includes_broker_deal_details(self):
        deal = SimpleNamespace(
            ticket=59139627883,
            order=59552012807,
            position_id=59552009263,
            symbol="EURUSD",
            type=1,
            entry=1,
            volume=0.02,
            price=1.09704,
            profit=0.04,
            commission=0,
            swap=0,
            comment="AXYL0123456789abcdef0123",
            time_msc=1_000_000,
        )
        mt5 = SimpleNamespace(
            TRADE_RETCODE_DONE=10009,
            DEAL_TYPE_BUY=0,
            DEAL_TYPE_SELL=1,
            DEAL_ENTRY_IN=0,
            DEAL_ENTRY_OUT=1,
            DEAL_ENTRY_INOUT=2,
            DEAL_ENTRY_OUT_BY=3,
            history_deals_get=lambda **kwargs: [deal] if kwargs == {"ticket": 59139627883} else [],
        )
        bridge = Mt5Bridge(mt5, object(), server_utc_offset_seconds=0)

        result = bridge._order_result(
            {"id": "0ec16d79-87dc-49bf-9480-8d679f53b4ba"},
            SimpleNamespace(
                retcode=10009,
                comment="Request executed",
                order=59552012807,
                deal=59139627883,
                volume=0.02,
                price=1.09704,
            ),
            "close_position",
        )

        self.assertEqual(result["status"], "closed")
        self.assertEqual(result["deals"][0]["ticket"], "59139627883")
        self.assertEqual(result["deals"][0]["entry"], "out")
        self.assertEqual(result["deals"][0]["price"], 1.09704)

    def test_reconciliation_sums_partial_fills_without_replaying(self):
        intent_id = "0ec16d79-87dc-49bf-9480-8d679f53b4ba"
        comment = f"AXYL{intent_id.replace('-', '')[:20]}"
        client_posts = []
        mt5 = SimpleNamespace(
            ACCOUNT_TRADE_MODE_DEMO=0,
            trade_mode=0,
            ORDER_STATE_CANCELED=2,
            ORDER_STATE_REJECTED=3,
            ORDER_STATE_EXPIRED=4,
            ORDER_STATE_PARTIAL=5,
            ORDER_STATE_FILLED=6,
            account_info=lambda: SimpleNamespace(
                trade_mode=0,
                login=12345678,
                server="Demo-Server",
                trade_allowed=False,
            ),
            positions_get=lambda: [],
            orders_get=lambda: [],
            history_orders_get=lambda *_args: [],
            history_deals_get=lambda *_args: [
                SimpleNamespace(ticket=11, comment=comment, volume=0.4),
                SimpleNamespace(ticket=12, comment=comment, volume=0.6),
            ],
        )
        client = SimpleNamespace(post=lambda endpoint, payload: client_posts.append((endpoint, payload)))
        bridge = Mt5Bridge(mt5, client)
        bridge._reconcile_command({
            "id": intent_id,
            "accountLogin": "12345678",
            "accountServer": "Demo-Server",
            "operation": "place_order",
            "volume": "1.0",
        })

        self.assertEqual(client_posts[-1][1]["status"], "filled")
        self.assertEqual(client_posts[-1][1]["filledVolume"], "1.0")

    def test_exact_and_unique_broker_symbol_mapping(self):
        available = ["EURUSD.a", "GBPUSD", "USDJPY.pro"]
        self.assertEqual(resolve_broker_symbol("GBPUSD", available), "GBPUSD")
        self.assertEqual(resolve_broker_symbol("EURUSD", available), "EURUSD.a")
        self.assertEqual(resolve_broker_symbol("USDJPY", available), "USDJPY.pro")

    def test_ambiguous_suffix_mapping_requires_operator_override(self):
        available = ["EURUSD.a", "EURUSD.pro"]
        self.assertIsNone(resolve_broker_symbol("EURUSD", available))
        self.assertEqual(resolve_broker_symbol("EURUSD", available, "EURUSD.pro"), "EURUSD.pro")

    def test_candle_time_and_closed_state_are_normalized(self):
        row = SimpleNamespace(
            time=1_795_700_000,
            open=1.08,
            high=1.081,
            low=1.079,
            close=1.0805,
            tick_volume=42,
            real_volume=0,
            spread=2,
        )
        candle = candle_payload("EURUSD.a", "M30", 1800, row, 1_795_701_800_000, 7200)
        self.assertEqual(candle["openTimeMs"], 1_795_692_800_000)
        self.assertEqual(candle["closeTimeMs"], 1_795_694_599_999)
        self.assertTrue(candle["isClosed"])
        self.assertEqual(candle["tickVolume"], 42.0)

    def test_numpy_style_rows_are_read_by_field_name(self):
        row = IndexedRow(
            time=1_795_700_000,
            open=1.08,
            high=1.081,
            low=1.079,
            close=1.0805,
            tick_volume=42,
            real_volume=0,
            spread=2,
        )
        candle = candle_payload("EURUSD.a", "M30", 1800, row, 1_795_701_800_000)
        self.assertEqual(candle["close"], 1.0805)

    def test_failed_market_data_submission_is_retried(self):
        row = {
            "time": 1_795_700_000,
            "open": 1.08,
            "high": 1.081,
            "low": 1.079,
            "close": 1.0805,
            "tick_volume": 42,
            "real_volume": 0,
            "spread": 2,
        }
        bridge = Mt5Bridge(
            SimpleNamespace(copy_rates_from_pos=lambda *_args: [row]),
            RetryingClient(),
            clock_ms=lambda: 1_795_701_800_000,
        )
        candles = bridge._rates("EURUSD.a", "M30", 30, 1800, 1)
        self.assertEqual(len(candles), 1)
        with self.assertRaisesRegex(RuntimeError, "temporary network failure"):
            bridge._send_market_data({"login": "123", "server": "Demo"}, [], candles)
        self.assertEqual(bridge._rates("EURUSD.a", "M30", 30, 1800, 1), candles)
        bridge._send_market_data({"login": "123", "server": "Demo"}, [], candles)
        self.assertEqual(bridge._rates("EURUSD.a", "M30", 30, 1800, 1), [])


if __name__ == "__main__":
    unittest.main()
