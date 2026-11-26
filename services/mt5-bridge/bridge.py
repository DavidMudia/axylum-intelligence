from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import signal
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Iterable
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse
from uuid import UUID


LOG = logging.getLogger("axylum.mt5")
TIMEFRAMES = (
    ("M1", "TIMEFRAME_M1", 60),
    ("M5", "TIMEFRAME_M5", 300),
    ("M15", "TIMEFRAME_M15", 900),
    ("M30", "TIMEFRAME_M30", 1800),
    ("H1", "TIMEFRAME_H1", 3600),
    ("H4", "TIMEFRAME_H4", 14400),
    ("D1", "TIMEFRAME_D1", 86400),
    ("W1", "TIMEFRAME_W1", 604800),
)
DEFAULT_SYMBOLS = ("EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "XAUUSD", "US30", "NAS100")
ASSET_CURRENCY = re.compile(r"^[A-Z]{6}$")


def _field(value: Any, name: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(name, default)
    try:
        return value[name]
    except (IndexError, KeyError, TypeError, ValueError):
        pass
    return getattr(value, name, default)


def _number(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if result == result and abs(result) != float("inf") else default


def _jsonable_number(value: Any) -> float:
    result = _number(value, float("nan"))
    if result != result or abs(result) == float("inf"):
        raise ValueError("MT5 returned a non-finite numeric value")
    return result


def _time_milliseconds(seconds: Any) -> int:
    return int(_number(seconds) * 1000)


def _canonicalize(value: str) -> str:
    return "".join(character for character in value.upper() if character.isalnum())


def resolve_broker_symbol(canonical: str, available: Iterable[str], override: str | None = None) -> str | None:
    names = list(available)
    if override:
        return override if override in names else None
    wanted = _canonicalize(canonical)
    exact = [name for name in names if _canonicalize(name) == wanted]
    if len(exact) == 1:
        return exact[0]
    candidates = [
        name for name in names
        if _canonicalize(name) != wanted
        and len(_canonicalize(name)) - len(wanted) <= 8
        and (_canonicalize(name).startswith(wanted) or _canonicalize(name).endswith(wanted))
    ]
    return candidates[0] if len(candidates) == 1 else None


def _asset_class(symbol: str) -> str:
    canonical = _canonicalize(symbol)
    if canonical.startswith(("XAU", "XAG", "XPT", "XPD")):
        return "metal"
    if ASSET_CURRENCY.fullmatch(canonical):
        return "forex"
    if canonical.startswith(("BTC", "ETH", "LTC", "XRP")):
        return "crypto"
    if any(name in canonical for name in ("US30", "NAS100", "SPX", "DAX", "FTSE", "NIKKEI")):
        return "index"
    if any(name in canonical for name in ("OIL", "WTI", "BRENT", "NGAS", "NATGAS")):
        return "commodity"
    return "other"


def _account_type(mt5: Any, trade_mode: Any) -> str:
    if trade_mode == getattr(mt5, "ACCOUNT_TRADE_MODE_DEMO", object()):
        return "demo"
    if trade_mode == getattr(mt5, "ACCOUNT_TRADE_MODE_CONTEST", object()):
        return "contest"
    if trade_mode == getattr(mt5, "ACCOUNT_TRADE_MODE_REAL", object()):
        return "live"
    return "unknown"


def _instrument_snapshot(symbol: str, info: Any) -> dict[str, Any]:
    point = _number(_field(info, "point"))
    tick_size = _number(_field(info, "trade_tick_size"), point)
    volume_min = _number(_field(info, "volume_min"))
    volume_max = _number(_field(info, "volume_max"))
    volume_step = _number(_field(info, "volume_step"))
    contract_size = _number(_field(info, "trade_contract_size"), 1.0)
    if point <= 0 or tick_size <= 0 or contract_size <= 0 or volume_min <= 0 or volume_max < volume_min or volume_step <= 0:
        raise ValueError(f"MT5 returned incomplete trading specifications for {symbol}")
    return {
        "brokerSymbol": symbol,
        "canonicalSymbol": _canonicalize(str(_field(info, "name", symbol))),
        "assetClass": _asset_class(symbol),
        "description": str(_field(info, "description", ""))[:256],
        "baseCurrency": _field(info, "currency_base"),
        "quoteCurrency": _field(info, "currency_profit"),
        "digits": int(_number(_field(info, "digits"))),
        "point": point,
        "tickSize": tick_size,
        "tickValue": max(0.0, _number(_field(info, "trade_tick_value"))),
        "contractSize": contract_size,
        "volumeMin": volume_min,
        "volumeMax": volume_max,
        "volumeStep": volume_step,
        "stopsLevelPoints": max(0, int(_number(_field(info, "trade_stops_level")))),
    }


def _nullable_positive(value: Any) -> float | None:
    number = _number(value)
    return number if number > 0 else None


def candle_payload(
    symbol: str,
    timeframe: str,
    duration: int,
    row: Any,
    now_ms: int,
    server_utc_offset_seconds: int = 0,
) -> dict[str, Any]:
    open_time_ms = _time_milliseconds(_field(row, "time")) - server_utc_offset_seconds * 1000
    close_time_ms = open_time_ms + duration * 1000 - 1
    return {
        "brokerSymbol": symbol,
        "timeframe": timeframe,
        "openTimeMs": open_time_ms,
        "closeTimeMs": close_time_ms,
        "open": _jsonable_number(_field(row, "open")),
        "high": _jsonable_number(_field(row, "high")),
        "low": _jsonable_number(_field(row, "low")),
        "close": _jsonable_number(_field(row, "close")),
        "tickVolume": _jsonable_number(_field(row, "tick_volume")),
        "realVolume": _jsonable_number(_field(row, "real_volume")),
        "spreadPoints": max(0, int(_number(_field(row, "spread")))),
        "isClosed": close_time_ms < now_ms,
    }


class SignedAxylumClient:
    def __init__(self, base_url: str, bridge_id: str, token: str, timeout: int = 15) -> None:
        self.base_url = base_url.rstrip("/")
        self.bridge_id = bridge_id
        self.token = token
        self.timeout = timeout

    def post(self, endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=True)
        timestamp = str(int(time.time()))
        message = f"{timestamp}.{body}".encode("utf-8")
        signature = hmac.new(self.token.encode("ascii"), message, hashlib.sha256).hexdigest()
        request = urllib.request.Request(
            f"{self.base_url}{endpoint}",
            data=body.encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "X-Axylum-Bridge-Id": self.bridge_id,
                "X-Axylum-Timestamp": timestamp,
                "X-Axylum-Signature": signature,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                result = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read(1024).decode("utf-8", errors="replace")
            raise RuntimeError(f"Axylum bridge request failed ({error.code}): {detail}") from error
        if not isinstance(result, dict) or result.get("accepted") is not True:
            raise RuntimeError("Axylum did not acknowledge the bridge request")
        return result


class Mt5Bridge:
    def __init__(
        self,
        mt5: Any,
        client: SignedAxylumClient,
        *,
        terminal_path: str | None = None,
        requested_symbols: Iterable[str] = DEFAULT_SYMBOLS,
        symbol_overrides: dict[str, str] | None = None,
        history_bars: int = 500,
        server_utc_offset_seconds: int = 0,
        clock_ms: Callable[[], int] | None = None,
    ) -> None:
        self.mt5 = mt5
        self.client = client
        self.terminal_path = terminal_path
        self.requested_symbols = tuple(requested_symbols)
        self.symbol_overrides = symbol_overrides or {}
        self.history_bars = max(100, min(int(history_bars), 5000))
        self.server_utc_offset_seconds = int(server_utc_offset_seconds)
        self.clock_ms = clock_ms or (lambda: int(time.time() * 1000))
        self.connected = False
        self.seeded: set[tuple[str, str]] = set()
        self.last_candles: dict[tuple[str, str, int], str] = {}
        self.symbols: dict[str, dict[str, Any]] = {}
        self.last_heartbeat_ms = 0
        self.last_snapshot_ms = 0
        self.last_account_identity: tuple[str, str] | None = None
        self.timeframes = [
            (label, getattr(mt5, constant, None), duration)
            for label, constant, duration in TIMEFRAMES
            if getattr(mt5, constant, None) is not None
        ]

    def _utc_timestamp_ms(self, server_time_ms: int) -> int:
        return server_time_ms - self.server_utc_offset_seconds * 1000

    def connect(self) -> None:
        initialized = self.mt5.initialize(self.terminal_path) if self.terminal_path else self.mt5.initialize()
        if not initialized:
            raise RuntimeError(f"MT5 terminal initialization failed: {self.mt5.last_error()}")
        account = self.mt5.account_info()
        if account is None:
            self.mt5.shutdown()
            raise RuntimeError(f"MT5 has no authenticated terminal account: {self.mt5.last_error()}")
        self.last_account_identity = (
            str(_field(account, "login")),
            str(_field(account, "server", "")),
        )
        self.connected = True
        self.refresh_symbols()

    def refresh_symbols(self) -> None:
        available = self.mt5.symbols_get()
        if available is None:
            raise RuntimeError(f"MT5 symbol discovery failed: {self.mt5.last_error()}")
        names = [str(_field(item, "name", "")) for item in available]
        discovered: dict[str, dict[str, Any]] = {}
        for canonical in self.requested_symbols:
            broker_symbol = resolve_broker_symbol(
                canonical,
                names,
                self.symbol_overrides.get(canonical),
            )
            if broker_symbol is None:
                LOG.warning("No unique broker symbol found for %s; configure an explicit symbol mapping if supported", canonical)
                continue
            if not self.mt5.symbol_select(broker_symbol, True):
                LOG.warning("Broker symbol %s could not be selected: %s", broker_symbol, self.mt5.last_error())
                continue
            info = self.mt5.symbol_info(broker_symbol)
            if info is None:
                LOG.warning("Broker returned no specifications for %s", broker_symbol)
                continue
            try:
                snapshot = _instrument_snapshot(broker_symbol, info)
            except ValueError as error:
                LOG.warning("%s", error)
                continue
            snapshot["canonicalSymbol"] = canonical
            discovered[canonical] = snapshot
        if not discovered:
            raise RuntimeError("No requested MT5 symbols are available; configure broker-specific symbol mappings.")
        self.symbols = discovered

    def _deal_payload(self, deal: Any) -> dict[str, Any] | None:
        deal_type = _field(deal, "type")
        if deal_type not in (self.mt5.DEAL_TYPE_BUY, self.mt5.DEAL_TYPE_SELL):
            return None
        deal_entry_map = {
            getattr(self.mt5, "DEAL_ENTRY_IN", -1): "in",
            getattr(self.mt5, "DEAL_ENTRY_OUT", -1): "out",
            getattr(self.mt5, "DEAL_ENTRY_INOUT", -1): "inout",
            getattr(self.mt5, "DEAL_ENTRY_OUT_BY", -1): "out_by",
        }
        entry = deal_entry_map.get(_field(deal, "entry"))
        if entry is None:
            return None
        return {
            "ticket": str(_field(deal, "ticket")),
            "orderTicket": str(_field(deal, "order")) if _field(deal, "order") else None,
            "positionTicket": str(_field(deal, "position_id")) if _field(deal, "position_id") else None,
            "brokerSymbol": str(_field(deal, "symbol", "")),
            "side": "buy" if deal_type == self.mt5.DEAL_TYPE_BUY else "sell",
            "entry": entry,
            "volume": _jsonable_number(_field(deal, "volume")),
            "price": _jsonable_number(_field(deal, "price")),
            "profit": _jsonable_number(_field(deal, "profit")),
            "commission": _jsonable_number(_field(deal, "commission")),
            "swap": _jsonable_number(_field(deal, "swap")),
            "comment": str(_field(deal, "comment", ""))[:256],
            "timeMs": self._utc_timestamp_ms(
                int(_field(deal, "time_msc") or _time_milliseconds(_field(deal, "time")))
            ),
        }

    def _deal_payloads_by_ticket(self, ticket: int) -> list[dict[str, Any]]:
        try:
            rows = self.mt5.history_deals_get(ticket=ticket)
        except (AttributeError, RuntimeError, TypeError, ValueError) as error:
            LOG.warning("Could not immediately synchronize MT5 deal %s: %s", ticket, error)
            return []
        if rows is None:
            LOG.warning("Could not immediately synchronize MT5 deal %s: %s", ticket, self.mt5.last_error())
            return []
        payloads = []
        for row in rows:
            payload = self._deal_payload(row)
            if payload is not None:
                payloads.append(payload)
        return payloads

    def _account_payload(self) -> dict[str, Any]:
        account = self.mt5.account_info()
        if account is None:
            raise RuntimeError(f"MT5 account synchronization failed: {self.mt5.last_error()}")
        raw_positions = self.mt5.positions_get()
        raw_orders = self.mt5.orders_get()
        if raw_positions is None or raw_orders is None:
            raise RuntimeError(f"MT5 position/order synchronization failed: {self.mt5.last_error()}")
        now = datetime.now(timezone.utc)
        raw_deals = self.mt5.history_deals_get(now - timedelta(days=7), now)
        if raw_deals is None:
            raise RuntimeError(f"MT5 deal-history synchronization failed: {self.mt5.last_error()}")
        positions = []
        for position in raw_positions:
            position_type = _field(position, "type")
            if position_type not in (self.mt5.POSITION_TYPE_BUY, self.mt5.POSITION_TYPE_SELL):
                continue
            positions.append({
                "ticket": str(_field(position, "ticket")),
                "brokerSymbol": str(_field(position, "symbol", "")),
                "side": "buy" if position_type == self.mt5.POSITION_TYPE_BUY else "sell",
                "volume": _jsonable_number(_field(position, "volume")),
                "openPrice": _jsonable_number(_field(position, "price_open")),
                "currentPrice": _jsonable_number(_field(position, "price_current")),
                "stopLoss": _nullable_positive(_field(position, "sl")),
                "takeProfit": _nullable_positive(_field(position, "tp")),
                "profit": _jsonable_number(_field(position, "profit")),
                "swap": _jsonable_number(_field(position, "swap")),
                "openedAtMs": self._utc_timestamp_ms(
                    int(_field(position, "time_msc") or _time_milliseconds(_field(position, "time")))
                ),
            })
        pending_type_map = {
            getattr(self.mt5, "ORDER_TYPE_BUY_LIMIT", -1): ("buy_limit", "buy"),
            getattr(self.mt5, "ORDER_TYPE_SELL_LIMIT", -1): ("sell_limit", "sell"),
            getattr(self.mt5, "ORDER_TYPE_BUY_STOP", -1): ("buy_stop", "buy"),
            getattr(self.mt5, "ORDER_TYPE_SELL_STOP", -1): ("sell_stop", "sell"),
        }
        pending_orders = []
        for order in raw_orders:
            normalized = pending_type_map.get(_field(order, "type"))
            if normalized is None:
                continue
            order_type, side = normalized
            pending_orders.append({
                "ticket": str(_field(order, "ticket")),
                "brokerSymbol": str(_field(order, "symbol", "")),
                "orderType": order_type,
                "side": side,
                "volume": _jsonable_number(_field(order, "volume_current", _field(order, "volume_initial"))),
                "price": _jsonable_number(_field(order, "price_open")),
                "stopLoss": _nullable_positive(_field(order, "sl")),
                "takeProfit": _nullable_positive(_field(order, "tp")),
                "createdAtMs": self._utc_timestamp_ms(
                    int(_field(order, "time_setup_msc") or _time_milliseconds(_field(order, "time_setup")))
                ),
            })
        deals = []
        for deal in sorted(raw_deals, key=lambda item: int(_field(item, "time_msc") or 0))[-1000:]:
            payload = self._deal_payload(deal)
            if payload is not None:
                deals.append(payload)
        account_type = _account_type(self.mt5, _field(account, "trade_mode"))
        return {
            "terminalVersion": ".".join(str(item) for item in (self.mt5.version() or ())),
            "account": {
                "login": str(_field(account, "login")),
                "server": str(_field(account, "server", "")),
                "broker": str(_field(account, "company", "")),
                "accountType": account_type,
                "currency": str(_field(account, "currency", "")),
                "leverage": int(_number(_field(account, "leverage"))),
                "balance": _jsonable_number(_field(account, "balance")),
                "equity": _jsonable_number(_field(account, "equity")),
                "freeMargin": _jsonable_number(_field(account, "margin_free")),
                "usedMargin": _jsonable_number(_field(account, "margin")),
                "marginLevel": None if _field(account, "margin_level") is None else _jsonable_number(_field(account, "margin_level")),
                "floatingProfit": _jsonable_number(_field(account, "profit")),
                "tradingAllowed": bool(_field(account, "trade_allowed", False)),
                "expertAllowed": bool(_field(account, "trade_expert", False)),
            },
            "instruments": list(self.symbols.values()),
            "positions": positions,
            "pendingOrders": pending_orders,
            "deals": deals,
        }

    def _tick_payload(self, broker_symbol: str) -> dict[str, Any] | None:
        tick = self.mt5.symbol_info_tick(broker_symbol)
        if tick is None:
            return None
        server_time_ms = int(_field(tick, "time_msc") or _time_milliseconds(_field(tick, "time")))
        time_ms = self._utc_timestamp_ms(server_time_ms)
        bid = _jsonable_number(_field(tick, "bid"))
        ask = _jsonable_number(_field(tick, "ask"))
        if bid <= 0 or ask < bid:
            return None
        last_value = _number(_field(tick, "last"))
        volume_value = _field(tick, "volume_real")
        if volume_value is None:
            volume_value = _field(tick, "volume")
        tick_signature = f"{time_ms}:{bid}:{ask}:{last_value}:{volume_value}:{_field(tick, 'flags', 0)}"
        return {
            "brokerSymbol": broker_symbol,
            "sourceTickId": tick_signature[:180],
            "timeMs": time_ms,
            "bid": bid,
            "ask": ask,
            "last": last_value if last_value > 0 else None,
            "volume": max(0.0, _number(volume_value)),
        }

    def _rates(
        self,
        broker_symbol: str,
        timeframe: str,
        timeframe_id: int,
        duration: int,
        count: int,
        start_position: int = 0,
    ) -> list[dict[str, Any]]:
        rates = self.mt5.copy_rates_from_pos(broker_symbol, timeframe_id, start_position, count)
        if rates is None:
            LOG.warning("MT5 rates unavailable for %s %s: %s", broker_symbol, timeframe, self.mt5.last_error())
            return []
        now_ms = self.clock_ms()
        result = []
        for row in rates:
            try:
                candle = candle_payload(
                    broker_symbol,
                    timeframe,
                    duration,
                    row,
                    now_ms,
                    self.server_utc_offset_seconds,
                )
            except (TypeError, ValueError) as error:
                LOG.warning("Skipping invalid MT5 candle for %s %s: %s", broker_symbol, timeframe, error)
                continue
            key = (broker_symbol, timeframe, candle["openTimeMs"])
            fingerprint = json.dumps(candle, sort_keys=True, separators=(",", ":"))
            if self.last_candles.get(key) == fingerprint:
                continue
            result.append(candle)
        return result

    def _send_market_data(self, account: dict[str, Any], ticks: list[dict[str, Any]], candles: list[dict[str, Any]]) -> None:
        login = account["login"]
        server = account["server"]
        chunk_size = 500
        if not ticks and not candles:
            return
        for start in range(0, max(len(ticks), len(candles)), chunk_size):
            payload = {
                "login": login,
                "server": server,
                "ticks": ticks[start : start + chunk_size],
                "candles": candles[start : start + chunk_size],
            }
            self.client.post("/api/mt5/bridge/market-data", payload)
        for candle in candles:
            key = (candle["brokerSymbol"], candle["timeframe"], candle["openTimeMs"])
            self.last_candles[key] = json.dumps(candle, sort_keys=True, separators=(",", ":"))

    def _command_order_type(self, command: dict[str, Any]) -> int:
        side = command.get("side")
        order_type = command.get("orderType")
        if order_type == "market" or command.get("operation") == "close_position":
            return self.mt5.ORDER_TYPE_BUY if side == "buy" else self.mt5.ORDER_TYPE_SELL
        mapping = {
            ("buy", "limit"): self.mt5.ORDER_TYPE_BUY_LIMIT,
            ("sell", "limit"): self.mt5.ORDER_TYPE_SELL_LIMIT,
            ("buy", "stop"): self.mt5.ORDER_TYPE_BUY_STOP,
            ("sell", "stop"): self.mt5.ORDER_TYPE_SELL_STOP,
        }
        try:
            return mapping[(side, order_type)]
        except KeyError as error:
            raise ValueError("Unsupported MT5 order type") from error

    def _matches_demo_account(self, command: dict[str, Any], require_trade_allowed: bool = True) -> bool:
        account = self.mt5.account_info()
        return bool(
            account is not None
            and _account_type(self.mt5, _field(account, "trade_mode")) == "demo"
            and (not require_trade_allowed or bool(_field(account, "trade_allowed", False)))
            and str(_field(account, "login")) == command.get("accountLogin")
            and str(_field(account, "server", "")) == command.get("accountServer")
        )

    def _current_order_price(self, command: dict[str, Any]) -> tuple[float, float, float]:
        symbol = command.get("brokerSymbol")
        tick = self.mt5.symbol_info_tick(symbol)
        info = self.mt5.symbol_info(symbol)
        if tick is None or info is None:
            raise RuntimeError(f"MT5 quote unavailable for {symbol}: {self.mt5.last_error()}")
        bid = _jsonable_number(_field(tick, "bid"))
        ask = _jsonable_number(_field(tick, "ask"))
        point = _number(_field(info, "point"))
        if bid <= 0 or ask < bid or point <= 0:
            raise RuntimeError(f"MT5 quote or point size is invalid for {symbol}")
        quote_time_ms = self._utc_timestamp_ms(
            int(_field(tick, "time_msc") or _time_milliseconds(_field(tick, "time")))
        )
        if self.clock_ms() - quote_time_ms > 15_000:
            raise RuntimeError(f"MT5 quote is stale for {symbol}")
        order_type = command.get("orderType")
        if order_type == "market" or command.get("operation") == "close_position":
            price = ask if command.get("side") == "buy" else bid
        else:
            price = _jsonable_number(command.get("price"))
            side = command.get("side")
            pending_type = order_type
            valid = (
                pending_type == "limit" and (price < ask if side == "buy" else price > bid)
            ) or (
                pending_type == "stop" and (price > ask if side == "buy" else price < bid)
            )
            if not valid:
                raise RuntimeError("Pending order price no longer matches the live broker quote")
        max_spread = _number(command.get("payload", {}).get("maxSpreadPoints"), 30.0)
        spread_points = (ask - bid) / point
        if max_spread <= 0 or spread_points > max_spread:
            raise RuntimeError(f"Live spread {spread_points:.1f} points exceeds the {max_spread:.1f}-point limit")
        digits = int(_number(_field(info, "digits")))
        price = round(price, digits)
        stop_loss = command.get("stopLoss")
        take_profit = command.get("takeProfit")
        stop_distance = max(0, int(_number(_field(info, "trade_stops_level")))) * point
        side = command.get("side")
        if side == "buy":
            valid_stops = stop_loss is not None and take_profit is not None and float(stop_loss) < price and float(take_profit) > price
            valid_distance = stop_loss is not None and take_profit is not None and price - float(stop_loss) >= stop_distance and float(take_profit) - price >= stop_distance
        else:
            valid_stops = stop_loss is not None and take_profit is not None and float(take_profit) < price and float(stop_loss) > price
            valid_distance = stop_loss is not None and take_profit is not None and float(stop_loss) - price >= stop_distance and price - float(take_profit) >= stop_distance
        if command.get("operation") == "place_order" and (not valid_stops or not valid_distance):
            raise RuntimeError("Protective prices no longer satisfy broker stop-distance rules")
        return price, bid, ask

    def _filling_policy(self, symbol: str, pending: bool = False) -> int:
        if pending:
            return self.mt5.ORDER_FILLING_RETURN
        info = self.mt5.symbol_info(symbol)
        if info is None:
            raise RuntimeError(f"MT5 specifications unavailable for {symbol}")
        modes = int(_number(_field(info, "filling_mode")))
        if modes & int(getattr(self.mt5, "SYMBOL_FILLING_FOK", 1)):
            return self.mt5.ORDER_FILLING_FOK
        if modes & int(getattr(self.mt5, "SYMBOL_FILLING_IOC", 2)):
            return self.mt5.ORDER_FILLING_IOC
        if _field(info, "trade_exemode") != getattr(self.mt5, "SYMBOL_TRADE_EXECUTION_MARKET", -1):
            return self.mt5.ORDER_FILLING_RETURN
        raise RuntimeError(f"Broker exposes no supported market-order filling mode for {symbol}")

    def _preflight_command(self, command: dict[str, Any]) -> None:
        intent_id = command["id"]
        response: dict[str, Any] = {"intentId": intent_id}
        try:
            if not self._matches_demo_account(command):
                raise RuntimeError("The connected terminal is not the expected demo account")
            symbol = command["brokerSymbol"]
            order_type = self._command_order_type(command)
            price, _, _ = self._current_order_price(command)
            margin = self.mt5.order_calc_margin(order_type, symbol, 1.0, price)
            if margin is None or _number(margin) <= 0:
                raise RuntimeError(f"MT5 could not calculate broker margin: {self.mt5.last_error()}")
            response["marginPerLot"] = _jsonable_number(margin)
            account = self.mt5.account_info()
            response["equity"] = _jsonable_number(_field(account, "equity"))
            response["freeMargin"] = _jsonable_number(_field(account, "margin_free"))
            response["usedMargin"] = _jsonable_number(_field(account, "margin"))
        except Exception as error:
            response["error"] = str(error)[:512]
        self.client.post("/api/mt5/bridge/orders/preflight", response)

    def _order_comment(self, intent_id: str) -> str:
        return f"AXYL{intent_id.replace('-', '')[:20]}"

    def _order_result(self, command: dict[str, Any], result: Any, operation: str) -> dict[str, Any]:
        if result is None:
            return {
                "intentId": command["id"],
                "status": "unknown",
                "filledVolume": "0",
                "error": f"MT5 returned no result; inspect the terminal before any retry: {self.mt5.last_error()}",
                "result": {},
            }
        retcode = int(_number(_field(result, "retcode"), -1))
        comment = str(_field(result, "comment", ""))[:256]
        done = retcode == getattr(self.mt5, "TRADE_RETCODE_DONE", 10009)
        partial = retcode == getattr(self.mt5, "TRADE_RETCODE_DONE_PARTIAL", 10010)
        placed = retcode == getattr(self.mt5, "TRADE_RETCODE_PLACED", 10008)
        no_changes = retcode == getattr(self.mt5, "TRADE_RETCODE_NO_CHANGES", 10025)
        if partial:
            status = "partially_filled"
        elif placed or no_changes:
            status = "accepted"
        elif done and operation == "close_position":
            status = "closed"
        elif done and operation == "cancel_pending":
            status = "cancelled"
        elif done and operation == "place_order" and command.get("orderType") == "market":
            status = "filled"
        elif done:
            status = "accepted"
        else:
            status = "rejected"
        filled_volume = _number(_field(result, "volume")) if status in ("filled", "partially_filled", "closed") else 0
        deal_ticket = int(_number(_field(result, "deal"), 0))
        execution_result = {
            "retcode": retcode,
            "comment": comment,
            "orderTicket": str(_field(result, "order", "")),
            "dealTicket": str(_field(result, "deal", "")),
            "volume": str(_field(result, "volume", 0)),
            "price": str(_field(result, "price", 0)),
        }
        deal_payloads = self._deal_payloads_by_ticket(deal_ticket) if deal_ticket > 0 and status in (
            "filled",
            "partially_filled",
            "closed",
        ) else []
        response = {
            "intentId": command["id"],
            "status": status,
            "filledVolume": str(max(0.0, filled_volume)),
            "error": None if status not in ("rejected",) else f"MT5 rejected the request ({retcode}): {comment}",
            "result": execution_result,
        }
        if deal_payloads:
            response["deals"] = deal_payloads
        return response

    def _execute_command(self, command: dict[str, Any]) -> None:
        if not self._matches_demo_account(command):
            result = {
                "intentId": command["id"],
                "status": "rejected",
                "filledVolume": "0",
                "error": "Execution refused because the terminal account is not the expected demo account.",
                "result": {},
            }
            self.client.post("/api/mt5/bridge/orders/result", result)
            return
        operation = command["operation"]
        symbol = command.get("brokerSymbol")
        account = self.mt5.account_info()
        request: dict[str, Any]
        if operation in ("place_order", "close_position"):
            price, bid, ask = self._current_order_price(command)
            side = command.get("side")
            if operation == "place_order":
                volume = _jsonable_number(command.get("volume"))
                order_type = self._command_order_type(command)
                required_margin = self.mt5.order_calc_margin(order_type, symbol, volume, price)
                if required_margin is None or _number(required_margin) <= 0:
                    raise RuntimeError(f"Broker margin recalculation failed: {self.mt5.last_error()}")
                if _number(required_margin) > _number(_field(account, "margin_free")):
                    raise RuntimeError("Broker-calculated margin exceeds current free margin")
                pending = command.get("orderType") != "market"
                action = self.mt5.TRADE_ACTION_PENDING if pending else self.mt5.TRADE_ACTION_DEAL
                request = {
                    "action": action,
                    "symbol": symbol,
                    "volume": volume,
                    "type": order_type,
                    "price": price,
                    "sl": _jsonable_number(command.get("stopLoss")),
                    "tp": _jsonable_number(command.get("takeProfit")),
                    "deviation": 10,
                    "magic": 0x4158594C,
                    "comment": self._order_comment(command["id"]),
                    "type_time": self.mt5.ORDER_TIME_GTC,
                    "type_filling": self._filling_policy(symbol, pending),
                }
            else:
                ticket = int(command["payload"]["brokerTicket"])
                position_rows = self.mt5.positions_get(ticket=ticket)
                if not position_rows:
                    result = {
                        "intentId": command["id"],
                        "status": "unknown",
                        "filledVolume": "0",
                        "error": "Position not found at execution time; no retry was attempted.",
                        "result": {},
                    }
                    self.client.post("/api/mt5/bridge/orders/result", result)
                    return
                position = position_rows[0]
                close_volume = _jsonable_number(command.get("volume"))
                if close_volume > _number(_field(position, "volume")):
                    raise RuntimeError("Requested close volume exceeds the current position")
                order_type = self.mt5.ORDER_TYPE_SELL if side == "sell" else self.mt5.ORDER_TYPE_BUY
                required_margin = self.mt5.order_calc_margin(order_type, symbol, close_volume, price)
                if required_margin is None:
                    required_margin = 0
                request = {
                    "action": self.mt5.TRADE_ACTION_DEAL,
                    "symbol": symbol,
                    "position": ticket,
                    "volume": close_volume,
                    "type": order_type,
                    "price": bid if side == "sell" else ask,
                    "deviation": 10,
                    "magic": 0x4158594C,
                    "comment": self._order_comment(command["id"]),
                    "type_filling": self._filling_policy(symbol),
                }
        elif operation == "modify_position":
            ticket = int(command["payload"]["brokerTicket"])
            request = {
                "action": self.mt5.TRADE_ACTION_SLTP,
                "symbol": symbol,
                "position": ticket,
                "sl": _jsonable_number(command.get("stopLoss")),
                "tp": _jsonable_number(command.get("takeProfit")) if command.get("takeProfit") is not None else 0.0,
            }
        elif operation == "cancel_pending":
            request = {
                "action": self.mt5.TRADE_ACTION_REMOVE,
                "order": int(command["payload"]["brokerTicket"]),
                "comment": self._order_comment(command["id"]),
            }
        else:
            raise RuntimeError(f"Unsupported MT5 operation {operation}")

        checked = self.mt5.order_check(request)
        if checked is None:
            result = {
                "intentId": command["id"],
                "status": "rejected",
                "filledVolume": "0",
                "error": f"MT5 order_check failed: {self.mt5.last_error()}",
                "result": {},
            }
        else:
            check_code = int(_number(_field(checked, "retcode"), -1))
            if check_code not in (0, getattr(self.mt5, "TRADE_RETCODE_DONE", 10009)):
                result = {
                    "intentId": command["id"],
                    "status": "rejected",
                    "filledVolume": "0",
                    "error": f"MT5 order_check rejected the request ({check_code}): {_field(checked, 'comment', '')}",
                    "result": {"checkRetcode": check_code},
                }
            else:
                sent = self.mt5.order_send(request)
                result = self._order_result(command, sent, operation)
        self.client.post("/api/mt5/bridge/orders/result", result)

    def _reconcile_command(self, command: dict[str, Any]) -> None:
        if not self._matches_demo_account(command, require_trade_allowed=False):
            return
        start = datetime.now(timezone.utc) - timedelta(days=7)
        end = datetime.now(timezone.utc)
        positions = self.mt5.positions_get()
        orders = self.mt5.orders_get()
        history_orders = self.mt5.history_orders_get(start, end)
        history_deals = self.mt5.history_deals_get(start, end)
        if any(rows is None for rows in (positions, orders, history_orders, history_deals)):
            LOG.warning("Could not reconcile submitted intent %s: %s", command["id"], self.mt5.last_error())
            return
        comment = self._order_comment(command["id"])
        matched_deals = [row for row in history_deals if _field(row, "comment") == comment]
        matched_order = next((row for row in list(orders) + list(history_orders) if _field(row, "comment") == comment), None)
        result: dict[str, Any] = {
            "intentId": command["id"],
            "filledVolume": "0",
            "result": {},
        }
        if matched_deals:
            filled_volume = sum(_number(_field(row, "volume")) for row in matched_deals)
            requested_volume = _number(command.get("volume"))
            complete = requested_volume > 0 and filled_volume + 1e-8 >= requested_volume
            operation = command.get("operation")
            status = "closed" if operation == "close_position" and complete else (
                "filled" if complete else "partially_filled" if filled_volume > 0 else "unknown"
            )
            result.update({
                "status": status,
                "filledVolume": str(filled_volume),
                "result": {
                    "dealTickets": [str(_field(row, "ticket", "")) for row in matched_deals],
                    "comment": comment,
                    "reconciled": True,
                },
            })
        elif matched_order is not None:
            state = _field(matched_order, "state")
            canceled = state == getattr(self.mt5, "ORDER_STATE_CANCELED", object())
            rejected = state in (
                getattr(self.mt5, "ORDER_STATE_REJECTED", object()),
                getattr(self.mt5, "ORDER_STATE_EXPIRED", object()),
            )
            partial = state == getattr(self.mt5, "ORDER_STATE_PARTIAL", object())
            filled = state == getattr(self.mt5, "ORDER_STATE_FILLED", object())
            initial_volume = _number(_field(matched_order, "volume_initial"))
            remaining_volume = _number(_field(matched_order, "volume_current"))
            filled_volume = max(0.0, initial_volume - remaining_volume)
            if canceled:
                status = "cancelled"
            elif rejected:
                status = "rejected"
            elif filled:
                status = "closed" if command.get("operation") == "close_position" else "filled"
            elif partial:
                status = "partially_filled"
            else:
                status = "accepted"
            result.update({
                "status": status,
                "filledVolume": str(filled_volume),
                "error": "The broker rejected or expired the order." if rejected else None,
                "result": {
                    "orderTicket": str(_field(matched_order, "ticket", "")),
                    "comment": comment,
                    "reconciled": True,
                },
            })
        else:
            result.update({
                "status": "unknown",
                "error": "No matching broker ticket was found after a submitted request; it was not replayed.",
                "result": {"reconciled": True},
            })
        self.client.post("/api/mt5/bridge/orders/result", result)

    def poll_order_commands(self) -> None:
        commands = self.client.post("/api/mt5/bridge/orders/commands", {})
        for command in commands.get("preflight", []):
            self._preflight_command(command)
        for command in commands.get("execute", []):
            self._execute_command(command)
        for command in commands.get("reconcile", []):
            self._reconcile_command(command)

    def synchronize(self) -> None:
        if not self.connected:
            self.connect()
        now_ms = self.clock_ms()
        account = self.mt5.account_info()
        if account is None:
            raise RuntimeError(f"MT5 account synchronization failed: {self.mt5.last_error()}")
        account_identity = {
            "login": str(_field(account, "login")),
            "server": str(_field(account, "server", "")),
        }
        account_changed = (account_identity["login"], account_identity["server"]) != self.last_account_identity
        if account_changed:
            self.refresh_symbols()
            self.seeded.clear()
            self.last_candles.clear()
        if now_ms - self.last_heartbeat_ms >= 15_000:
            self.client.post("/api/mt5/bridge/heartbeat", {
                "terminalVersion": ".".join(str(item) for item in (self.mt5.version() or ())),
            })
            self.last_heartbeat_ms = now_ms
        if account_changed or now_ms - self.last_snapshot_ms >= 30_000:
            snapshot = self._account_payload()
            self.client.post("/api/mt5/bridge/snapshot", snapshot)
            self.last_snapshot_ms = now_ms
            self.last_account_identity = (account_identity["login"], account_identity["server"])
        ticks: list[dict[str, Any]] = []
        candles: list[dict[str, Any]] = []
        seeded_after_send: list[tuple[str, str]] = []
        for canonical, instrument in self.symbols.items():
            broker_symbol = instrument["brokerSymbol"]
            tick = self._tick_payload(broker_symbol)
            if tick:
                ticks.append(tick)
            for label, timeframe_id, duration in self.timeframes:
                key = (broker_symbol, label)
                if key not in self.seeded:
                    history = self._rates(broker_symbol, label, timeframe_id, duration, self.history_bars, 1)
                    if history:
                        for bar in history:
                            bar["isClosed"] = True
                        candles.extend(history)
                        seeded_after_send.append(key)
                else:
                    candles.extend(self._rates(broker_symbol, label, timeframe_id, duration, 2))
        self._send_market_data(account_identity, ticks, candles)
        self.seeded.update(seeded_after_send)
        self.poll_order_commands()

    def shutdown(self) -> None:
        if self.connected:
            self.mt5.shutdown()
        self.connected = False


def load_config() -> dict[str, Any]:
    base_url = os.environ.get("AXYLUM_API_BASE_URL", "").rstrip("/")
    bridge_id = os.environ.get("AXYLUM_BRIDGE_ID", "")
    token = os.environ.get("AXYLUM_BRIDGE_TOKEN", "")
    parsed_url = urlparse(base_url)
    local_http = parsed_url.scheme == "http" and parsed_url.hostname in {"127.0.0.1", "localhost"}
    if parsed_url.scheme != "https" and not local_http:
        raise ValueError("AXYLUM_API_BASE_URL must use HTTPS except for local development.")
    if parsed_url.username or parsed_url.password or not parsed_url.hostname:
        raise ValueError("AXYLUM_API_BASE_URL must not include user credentials.")
    try:
        server_utc_offset_seconds = int(os.environ.get("MT5_SERVER_UTC_OFFSET_SECONDS", "0"))
    except ValueError as error:
        raise ValueError("MT5_SERVER_UTC_OFFSET_SECONDS must be an integer.") from error
    if abs(server_utc_offset_seconds) > 14 * 60 * 60:
        raise ValueError("MT5_SERVER_UTC_OFFSET_SECONDS must be within +/-14 hours.")
    try:
        UUID(bridge_id)
    except ValueError as error:
        raise ValueError("AXYLUM_BRIDGE_ID must be the bridge UUID issued by the Axylum provision command.") from error
    if not re.fullmatch(r"[0-9a-fA-F]{64}", token):
        raise ValueError("AXYLUM_BRIDGE_TOKEN must be the one-time 64-character bridge token.")
    try:
        symbol_overrides = json.loads(os.environ.get("MT5_SYMBOL_MAP", "{}"))
    except json.JSONDecodeError as error:
        raise ValueError("MT5_SYMBOL_MAP must be a JSON object.") from error
    if not isinstance(symbol_overrides, dict) or not all(
        isinstance(key, str)
        and re.fullmatch(r"[A-Z0-9._#-]{1,32}", key)
        and isinstance(value, str)
        and re.fullmatch(r"[A-Za-z0-9._#-]{1,64}", value)
        for key, value in symbol_overrides.items()
    ):
        raise ValueError("MT5_SYMBOL_MAP must map canonical symbols to broker symbol strings.")
    requested_symbols = tuple(
        item.strip().upper() for item in os.environ.get("MT5_SYMBOLS", ",".join(DEFAULT_SYMBOLS)).split(",") if item.strip()
    )
    if not requested_symbols or not all(re.fullmatch(r"[A-Z0-9._#-]{1,32}", symbol) for symbol in requested_symbols):
        raise ValueError("MT5_SYMBOLS must be a comma-separated list of valid canonical instrument symbols.")
    return {
        "base_url": base_url,
        "bridge_id": bridge_id,
        "token": token,
        "terminal_path": os.environ.get("MT5_TERMINAL_PATH") or None,
        "requested_symbols": requested_symbols,
        "symbol_overrides": symbol_overrides,
        "history_bars": int(os.environ.get("MT5_HISTORY_BARS", "500")),
        "server_utc_offset_seconds": server_utc_offset_seconds,
        "poll_seconds": max(2, min(int(os.environ.get("MT5_POLL_SECONDS", "5")), 60)),
    }


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    config = load_config()
    try:
        import MetaTrader5 as mt5
    except ImportError as error:
        raise RuntimeError("Install the Windows bridge requirements before starting the MT5 connector.") from error

    client = SignedAxylumClient(config["base_url"], config["bridge_id"], config["token"])
    bridge = Mt5Bridge(
        mt5,
        client,
        terminal_path=config["terminal_path"],
        requested_symbols=config["requested_symbols"],
        symbol_overrides=config["symbol_overrides"],
        history_bars=config["history_bars"],
        server_utc_offset_seconds=config["server_utc_offset_seconds"],
    )
    stopping = False

    def stop(_signum: int, _frame: Any) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    retry_seconds = 2
    while not stopping:
        try:
            bridge.synchronize()
            retry_seconds = 2
            time.sleep(config["poll_seconds"])
        except Exception as error:
            LOG.error("Synchronization failed; no order will be replayed: %s", error)
            bridge.shutdown()
            time.sleep(retry_seconds)
            retry_seconds = min(retry_seconds * 2, 60)
    bridge.shutdown()


if __name__ == "__main__":
    main()
