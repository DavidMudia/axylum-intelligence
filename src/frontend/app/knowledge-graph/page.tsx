"use client";

import { Play, RotateCcw, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Badge, Button, PageHeader, Panel, PanelHeader, Segmented, Tabs } from "@/components/glass";
import { useSize } from "@/hooks/useSize";
import { cn } from "@/lib/format";
import { EDGES, GRAPH_SIZE, NODE_COLORS, NODES, RELATION_TYPES, SPARQL_PRESETS, nodeById, runSparql, toTurtle, type GEdge, type GNode, type NodeType } from "@backend/lib/graph";

type View = "explore" | "sparql";
type StatusFilter = "all" | "verified" | "inferred";
type Window = "1" | "6" | "24" | "all";

const GLOBE_CENTER = 500;
const GLOBE_RADIUS = 380;

function globeAngles(node: GNode) {
  return {
    longitude: (node.x / GRAPH_SIZE.w - 0.5) * Math.PI * 2,
    latitude: (0.5 - node.y / GRAPH_SIZE.h) * Math.PI * 0.82,
  };
}

function focusRotation(id: string) {
  const { longitude, latitude } = globeAngles(nodeById(id));
  return { x: latitude, y: -longitude };
}

function GlobeStage({
  edges,
  selected,
  onSelect,
  onClose,
  status,
  onStatusChange,
  windowH,
  onWindowChange,
}: {
  edges: GEdge[];
  selected: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  status: StatusFilter;
  onStatusChange: (status: StatusFilter) => void;
  windowH: Window;
  onWindowChange: (windowH: Window) => void;
}) {
  const [rotation, setRotation] = useState(() => focusRotation(selected));
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const globeSvg = useRef<SVGSVGElement>(null);
  const { ref: globeContainerRef, width: globeWidth } = useSize<HTMLDivElement>();
  const pointers = useRef(new Map<number, { x: number; y: number; startX: number; startY: number }>());
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const gestureMoved = useRef(false);
  const selectedNode = nodeById(selected);
  const globeNodeHitRadius = globeWidth > 0 ? Math.max(14, (22 * 1000) / globeWidth) : 22;
  const connections = useMemo<Array<{ edge: GEdge; id: string; direction: "out" | "in" }>>(
    () => edges.reduce<Array<{ edge: GEdge; id: string; direction: "out" | "in" }>>((result, edge) => {
      if (edge.source === selected) result.push({ edge, id: edge.target, direction: "out" });
      if (edge.target === selected) result.push({ edge, id: edge.source, direction: "in" });
      return result;
    }, []),
    [edges, selected],
  );
  const connected = useMemo(() => new Set(edges.flatMap((edge) => [edge.source, edge.target])), [edges]);
  const neighbours = useMemo(() => new Set([selected, ...connections.map((connection) => connection.id)]), [connections, selected]);
  const globePoints = useMemo(
    () =>
      new Map(
        NODES.map((node) => {
          const { longitude, latitude } = globeAngles(node);
          const cosLatitude = Math.cos(latitude);
          const x = cosLatitude * Math.sin(longitude);
          const y = Math.sin(latitude);
          const z = cosLatitude * Math.cos(longitude);
          const cosY = Math.cos(rotation.y);
          const sinY = Math.sin(rotation.y);
          const turnedX = x * cosY + z * sinY;
          const turnedZ = -x * sinY + z * cosY;
          const cosX = Math.cos(rotation.x);
          const sinX = Math.sin(rotation.x);
          const turnedY = y * cosX - turnedZ * sinX;
          const depth = y * sinX + turnedZ * cosX;

          return [node.id, { x: GLOBE_CENTER + turnedX * GLOBE_RADIUS * zoom, y: GLOBE_CENTER + turnedY * GLOBE_RADIUS * zoom, depth }] as const;
        }),
      ),
    [rotation.x, rotation.y, zoom],
  );
  const orderedNodes = useMemo(
    () => [...NODES].sort((a, b) => globePoints.get(a.id)!.depth - globePoints.get(b.id)!.depth),
    [globePoints],
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const svg = globeSvg.current;
    if (!svg) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((current) => Math.max(0.7, Math.min(2.2, current * Math.exp(-event.deltaY * 0.001))));
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, []);

  const selectNode = (id: string) => {
    onSelect(id);
    setRotation(focusRotation(id));
  };
  const zoomBy = (factor: number) => setZoom((current) => Math.max(0.7, Math.min(2.2, current * factor)));
  const resetGlobe = () => {
    setZoom(1);
    setRotation(focusRotation(selected));
  };
  const pointerDistance = (points: { x: number; y: number }[]) =>
    Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY };
    pointers.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size === 2) {
      const points = Array.from(pointers.current.values());
      pinch.current = { distance: pointerDistance(points), zoom };
      drag.current = null;
    } else {
      drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    }
    setDragging(true);
  };
  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = pointers.current.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX;
    point.y = event.clientY;
    if (Math.hypot(point.x - point.startX, point.y - point.startY) > 4) gestureMoved.current = true;

    if (pointers.current.size >= 2) {
      const distance = pointerDistance(Array.from(pointers.current.values()));
      const start = pinch.current;
      if (start && Math.abs(distance - start.distance) > 2) {
        gestureMoved.current = true;
        setZoom(Math.max(0.7, Math.min(2.2, start.zoom * (distance / start.distance))));
      }
      return;
    }

    const activeDrag = drag.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
    const dx = event.clientX - activeDrag.x;
    const dy = event.clientY - activeDrag.y;
    activeDrag.x = event.clientX;
    activeDrag.y = event.clientY;
    setRotation((current) => ({
      x: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, current.x + dy * 0.006)),
      y: current.y + dx * 0.006,
    }));
  };
  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    pinch.current = null;
    const remaining = Array.from(pointers.current.entries())[0];
    drag.current = remaining ? { pointerId: remaining[0], x: remaining[1].x, y: remaining[1].y } : null;
    setDragging(pointers.current.size > 0);
    if (gestureMoved.current) window.setTimeout(() => (gestureMoved.current = false), 0);
  };
  const toggleButtonClass = (active: boolean) =>
    cn("rounded-full border px-2.5 py-1 text-[10px] transition-colors", active ? "border-violet/40 bg-violet/15 text-[#c5bcff]" : "border-white/10 text-fg-3 hover:text-fg-2");

  return (
    <div className="fixed inset-0 z-[100] bg-[#05070c]/95 p-2 backdrop-blur-xl sm:p-4" role="dialog" aria-modal="true" aria-labelledby="knowledge-globe-title">
      <div className="mx-auto flex h-full max-w-[1800px] flex-col overflow-hidden rounded-[20px] border border-white/10 bg-[#0b0e14]/95 p-3 shadow-2xl sm:p-5">
        <header className="flex shrink-0 items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="eyebrow">Interactive knowledge globe</div>
            <h2 id="knowledge-globe-title" className="mt-1 truncate text-base font-medium text-fg sm:text-lg">
              {selectedNode.label}
              <span className="ml-2 text-xs font-normal text-fg-3">· {connected.size} entities · {edges.length} relationships</span>
            </h2>
            <p className="mt-1 hidden text-[11px] text-fg-3 sm:block">Drag to rotate · pinch or scroll to zoom · select a node to inspect</p>
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Close knowledge globe"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 text-fg-2 transition-colors hover:border-white/20 hover:bg-white/5 hover:text-fg"
          >
            <X size={16} />
          </button>
        </header>

        <div className="mt-3 grid min-h-0 flex-1 grid-rows-[minmax(150px,1fr)_minmax(110px,22dvh)] gap-2 sm:grid-rows-[minmax(200px,1fr)_minmax(120px,24dvh)] sm:gap-3 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-1">
          <section ref={globeContainerRef} className="relative min-h-0 overflow-hidden rounded-2xl border border-white/[0.07] bg-[radial-gradient(ellipse_at_center,rgba(91,141,239,0.1),rgba(7,9,13,0.2)_58%)]">
            <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full border border-white/10 bg-[#090c12]/80 p-1 backdrop-blur sm:left-4 sm:top-4">
              <button type="button" aria-label="Zoom out" onClick={() => zoomBy(0.82)} className="h-7 w-7 rounded-full text-sm text-fg-2 hover:bg-white/10 hover:text-fg">−</button>
              <span className="num min-w-10 text-center text-[10px] text-fg-3">{Math.round(zoom * 100)}%</span>
              <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.22)} className="h-7 w-7 rounded-full text-sm text-fg-2 hover:bg-white/10 hover:text-fg">+</button>
              <span className="mx-0.5 h-4 w-px bg-white/10" />
              <button type="button" onClick={resetGlobe} className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] text-fg-3 hover:bg-white/10 hover:text-fg">
                <RotateCcw size={11} /> Reset
              </button>
            </div>
            <button type="button" onClick={() => setRotation(focusRotation(selected))} className="absolute right-3 top-3 z-10 rounded-full border border-white/10 bg-[#090c12]/80 px-3 py-1.5 text-[10px] text-fg-2 backdrop-blur hover:text-fg sm:right-4 sm:top-4">
              Focus selected
            </button>
            <svg
              ref={globeSvg}
              viewBox="0 0 1000 1000"
              className="h-full w-full"
              role="group"
              aria-label="Interactive knowledge globe"
              style={{ touchAction: "none", cursor: dragging ? "grabbing" : "grab" }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <defs>
                <marker id="globe-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                  <path d="M0 0L10 5L0 10z" fill="rgba(163,171,187,0.7)" />
                </marker>
                <marker id="globe-arrow-inferred" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                  <path d="M0 0L10 5L0 10z" fill="rgba(214,162,74,0.8)" />
                </marker>
                <radialGradient id="globe-stage-sphere" cx="34%" cy="27%" r="75%">
                  <stop offset="0%" stopColor="#2b426c" stopOpacity="0.96" />
                  <stop offset="65%" stopColor="#111d32" stopOpacity="0.94" />
                  <stop offset="100%" stopColor="#090d17" stopOpacity="0.99" />
                </radialGradient>
                <clipPath id="globe-stage-clip">
                  <circle cx={GLOBE_CENTER} cy={GLOBE_CENTER} r={GLOBE_RADIUS * zoom} />
                </clipPath>
              </defs>
              <circle className="kg-globe-halo" cx={GLOBE_CENTER} cy={GLOBE_CENTER} r={GLOBE_RADIUS * zoom + 24} fill="rgba(91,141,239,0.08)" />
              <circle cx={GLOBE_CENTER} cy={GLOBE_CENTER} r={GLOBE_RADIUS * zoom} fill="url(#globe-stage-sphere)" stroke="rgba(124,166,255,0.58)" strokeWidth="2" />
              <g clipPath="url(#globe-stage-clip)" fill="none" stroke="rgba(145,177,235,0.2)" strokeWidth="1.5" pointerEvents="none">
                <ellipse cx={GLOBE_CENTER} cy={GLOBE_CENTER} rx={GLOBE_RADIUS * zoom * 0.42} ry={GLOBE_RADIUS * zoom} />
                <ellipse cx={GLOBE_CENTER} cy={GLOBE_CENTER} rx={GLOBE_RADIUS * zoom * 0.78} ry={GLOBE_RADIUS * zoom} />
                <ellipse cx={GLOBE_CENTER} cy={GLOBE_CENTER} rx={GLOBE_RADIUS * zoom} ry={GLOBE_RADIUS * zoom * 0.36} />
                <ellipse cx={GLOBE_CENTER} cy={GLOBE_CENTER} rx={GLOBE_RADIUS * zoom} ry={GLOBE_RADIUS * zoom * 0.72} />
              </g>
              {edges.map((edge) => {
                const from = globePoints.get(edge.source)!;
                const to = globePoints.get(edge.target)!;
                const dx = to.x - from.x;
                const dy = to.y - from.y;
                const distance = Math.hypot(dx, dy) || 1;
                const related = edge.source === selected || edge.target === selected;
                const farSide = from.depth < 0 && to.depth < 0;
                return (
                  <line
                    key={edge.id}
                    x1={from.x + (dx / distance) * 10}
                    y1={from.y + (dy / distance) * 10}
                    x2={to.x - (dx / distance) * 12}
                    y2={to.y - (dy / distance) * 12}
                    opacity={farSide ? 0.05 : related ? 0.88 : 0.22}
                    stroke={edge.status === "inferred" ? "#d6a24a" : "rgba(163,171,187,0.72)"}
                    strokeWidth={related ? 2 : 1.2}
                    strokeDasharray={edge.status === "inferred" ? "5 6" : undefined}
                    markerEnd={edge.status === "inferred" ? "url(#globe-arrow-inferred)" : "url(#globe-arrow)"}
                    style={{ transition: "x1 .2s ease, y1 .2s ease, x2 .2s ease, y2 .2s ease, opacity .2s ease" }}
                  />
                );
              })}
              {orderedNodes.map((node) => {
                const point = globePoints.get(node.id)!;
                const isSelected = node.id === selected;
                const isRelated = neighbours.has(node.id);
                const opacity = point.depth < 0 ? 0.14 : isRelated ? 1 : connected.has(node.id) ? 0.5 : 0.12;
                const color = NODE_COLORS[node.type];
                return (
                  <g
                    key={node.id}
                    transform={`translate(${point.x},${point.y})`}
                    opacity={opacity}
                    pointerEvents={point.depth < -0.04 ? "none" : "auto"}
                    role="button"
                    tabIndex={point.depth < -0.04 ? -1 : 0}
                    aria-hidden={point.depth < -0.04}
                    aria-label={`Select ${node.label}`}
                    aria-pressed={isSelected}
                    style={{ cursor: "pointer", touchAction: "manipulation", transition: "opacity .2s ease, transform .2s ease" }}
                    onClick={() => {
                      if (gestureMoved.current) {
                        gestureMoved.current = false;
                        return;
                      }
                      selectNode(node.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectNode(node.id);
                      }
                    }}
                  >
                    <circle r={globeNodeHitRadius} fill="transparent" pointerEvents="all" />
                    {isSelected && <circle r="22" fill="none" stroke={color} strokeWidth="1.5" strokeOpacity="0.8" />}
                    <circle r={node.type === "Cryptocurrency" ? 13 : 10} fill={color} fillOpacity="0.24" stroke={color} strokeWidth="1.8" />
                    <circle r={node.type === "Cryptocurrency" ? 4 : 3} fill={color} />
                    {(point.depth > 0.12 || isSelected) && (
                      <text y="31" textAnchor="middle" fontSize="15" fill={isSelected ? "#e8ebf2" : "#a3abbb"} stroke="#07090d" strokeWidth="4" style={{ paintOrder: "stroke" }}>
                        {node.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-full border border-white/[0.07] bg-[#090c12]/65 px-2.5 py-1 text-[9px] text-fg-4 backdrop-blur sm:bottom-4 sm:left-4 sm:text-[10px]">
              {Math.round(zoom * 100)}% zoom · {dragging ? "Rotating" : "Grab globe to rotate"}
            </div>
          </section>

          <aside className="min-h-0 overflow-y-auto rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: NODE_COLORS[selectedNode.type] }} />
              <span className="eyebrow">{selectedNode.type}</span>
            </div>
            <h3 className="mt-1 text-base font-medium text-fg">{selectedNode.label}</h3>
            <p className="mt-1.5 text-[11px] leading-relaxed text-fg-3">{selectedNode.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(selectedNode.props).slice(0, 4).map(([key, value]) => (
                <span key={key} className="rounded-md border border-white/[0.07] bg-black/20 px-2 py-1 text-[9px] text-fg-3">
                  <span className="text-fg-4">{key}: </span><span className="num text-fg-2">{value}</span>
                </span>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setRotation(focusRotation(selected))} className="flex items-center gap-1.5 rounded-full border border-violet/30 bg-violet/10 px-2.5 py-1.5 text-[10px] text-[#c5bcff] hover:bg-violet/15">
                Focus entity
              </button>
              <button type="button" onClick={resetGlobe} className="flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1.5 text-[10px] text-fg-3 hover:text-fg-2">
                <RotateCcw size={11} /> Reset globe
              </button>
            </div>

            <div className="mt-4 border-t border-white/[0.07] pt-3">
              <div className="eyebrow mb-2">Evidence filters</div>
              <div className="flex flex-wrap gap-1.5">
                {(["all", "verified", "inferred"] as const).map((value) => (
                  <button key={value} type="button" aria-pressed={status === value} onClick={() => onStatusChange(value)} className={toggleButtonClass(status === value)}>
                    {value === "all" ? "All" : value === "verified" ? "Verified" : "Inferred"}
                  </button>
                ))}
                {(["1", "6", "24", "all"] as const).map((value) => (
                  <button key={value} type="button" aria-pressed={windowH === value} onClick={() => onWindowChange(value)} className={toggleButtonClass(windowH === value)}>
                    {value === "all" ? "All time" : `${value}h`}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 border-t border-white/[0.07] pt-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="eyebrow">Connected entities</div>
                <span className="num text-[9px] text-fg-4">{connections.length}</span>
              </div>
              <div className="space-y-1.5">
                {connections.length ? connections.map(({ edge, id, direction }) => {
                  const relatedNode = nodeById(id);
                  return (
                    <button
                      key={edge.id}
                      type="button"
                      onClick={() => selectNode(id)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/15 px-2.5 py-2 text-left transition-colors hover:border-violet/25 hover:bg-white/[0.03]"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: NODE_COLORS[relatedNode.type] }} />
                        <span className="min-w-0 truncate text-[10px] text-fg-2">{relatedNode.label}</span>
                      </span>
                      <span className="num shrink-0 text-[9px] text-fg-4">{direction === "out" ? `${edge.rel} →` : `← ${edge.rel}`}</span>
                    </button>
                  );
                }) : <p className="py-2 text-[10px] text-fg-4">No relationships match the current filters.</p>}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Graph({ selected, onSelect, relations, status, onStatusChange, windowH, onWindowChange }: {
  selected: string;
  onSelect: (id: string) => void;
  relations: Set<string>;
  status: StatusFilter;
  onStatusChange: (status: StatusFilter) => void;
  windowH: Window;
  onWindowChange: (windowH: Window) => void;
}) {
  const { ref: graphRef, width: graphWidth } = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const [pulse, setPulse] = useState<number>(0);
  const [globeOpen, setGlobeOpen] = useState(false);
  const closeGlobe = useCallback(() => setGlobeOpen(false), []);

  useEffect(() => {
    const t = setInterval(() => setPulse((p) => (p + 1) % EDGES.length), 4200);
    return () => clearInterval(t);
  }, []);

  const edges = useMemo(
    () =>
      EDGES.filter(
        (e) => relations.has(e.rel) && (status === "all" || e.status === status) && (windowH === "all" || e.hoursAgo <= Number(windowH)),
      ),
    [relations, status, windowH],
  );
  const connected = useMemo(() => {
    const s = new Set<string>();
    edges.forEach((e) => {
      s.add(e.source);
      s.add(e.target);
    });
    return s;
  }, [edges]);
  const focus = hover ?? selected;
  const neighbours = useMemo(() => {
    const s = new Set<string>([focus]);
    edges.forEach((e) => {
      if (e.source === focus) s.add(e.target);
      if (e.target === focus) s.add(e.source);
    });
    return s;
  }, [edges, focus]);
  const pulseEdge = EDGES[pulse];
  const nodeHitRadius = graphWidth > 0 ? Math.max(14, (22 * GRAPH_SIZE.w) / graphWidth) : 14;

  return (
    <>
      <div ref={graphRef} className="relative">
        <button
          type="button"
          onClick={() => setGlobeOpen(true)}
          className="absolute right-4 top-4 z-10 rounded-full border border-white/10 bg-[#0b0e14]/85 px-3 py-1.5 text-[10.5px] text-fg-2 shadow-lg backdrop-blur transition-colors hover:border-violet/40 hover:text-fg"
        >
          Open globe
        </button>
        <svg
          viewBox={`0 0 ${GRAPH_SIZE.w} ${GRAPH_SIZE.h}`}
          className="block h-auto w-full"
          role="group"
          aria-label="Knowledge graph. Tap an empty area to open the globe."
          style={{ cursor: "zoom-in" }}
          onClick={() => setGlobeOpen(true)}
        >
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="rgba(163,171,187,0.7)" />
            </marker>
            <marker id="arr-v" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="rgba(214,162,74,0.8)" />
            </marker>
          </defs>
          {edges.map((e) => {
            const a = nodeById(e.source);
            const b = nodeById(e.target);
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.hypot(dx, dy) || 1;
            const sx = a.x + (dx / d) * 11;
            const sy = a.y + (dy / d) * 11;
            const ex = b.x - (dx / d) * 14;
            const ey = b.y - (dy / d) * 14;
            const active = neighbours.has(e.source) && neighbours.has(e.target) && (e.source === focus || e.target === focus);
            const inferred = e.status === "inferred";
            return (
              <g key={e.id} opacity={active ? 1 : 0.22} style={{ transition: "opacity .25s" }}>
                <line
                  x1={sx}
                  y1={sy}
                  x2={ex}
                  y2={ey}
                  stroke={inferred ? "#d6a24a" : "rgba(163,171,187,0.6)"}
                  strokeWidth={active ? 1.4 : 1}
                  strokeDasharray={inferred ? "4 5" : undefined}
                  markerEnd={inferred ? "url(#arr-v)" : "url(#arr)"}
                  className={cn(inferred && active && "anim-flow")}
                />
                {active && (
                  <text x={(sx + ex) / 2} y={(sy + ey) / 2 - 5} textAnchor="middle" fontSize="10.5" fill={inferred ? "#e3bd78" : "#a3abbb"} className="num" style={{ paintOrder: "stroke" }} stroke="#07090d" strokeWidth="3">
                    {e.rel}
                  </text>
                )}
              </g>
            );
          })}
          {NODES.map((n) => {
            const visible = connected.has(n.id) || n.id === selected;
            const dim = !neighbours.has(n.id);
            const color = NODE_COLORS[n.type];
            const sel = n.id === selected;
            const pulsing = edges.some((e) => e.id === pulseEdge.id) && (pulseEdge.source === n.id || pulseEdge.target === n.id);
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                opacity={!visible ? 0.1 : dim ? 0.35 : 1}
                role="button"
                tabIndex={visible ? 0 : -1}
                aria-label={`Select ${n.label}`}
                aria-hidden={!visible}
                style={{ cursor: "pointer", touchAction: "manipulation", transition: "opacity .25s" }}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(n.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(n.id);
                  }
                }}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
              >
                <circle r={nodeHitRadius} fill="transparent" pointerEvents="all" />
                {pulsing && (
                  <circle r="9" fill="none" stroke={color} strokeWidth="1">
                    <animate attributeName="r" values="9;26" dur="2.2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.7;0" dur="2.2s" repeatCount="indefinite" />
                  </circle>
                )}
                {sel && <circle r="15" fill="none" stroke={color} strokeOpacity="0.55" strokeWidth="1" />}
                <circle r={n.type === "Cryptocurrency" ? 9 : 7} fill={color} fillOpacity="0.22" stroke={color} strokeWidth="1.5" />
                <circle r={n.type === "Cryptocurrency" ? 3.2 : 2.4} fill={color} />
                <text y={n.type === "Cryptocurrency" ? 24 : 21} textAnchor="middle" fontSize="11" fill={sel ? "#e8ebf2" : "#a3abbb"} stroke="#07090d" strokeWidth="3" style={{ paintOrder: "stroke" }}>
                  {n.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {globeOpen && createPortal(
        <GlobeStage
          edges={edges}
          selected={selected}
          onSelect={onSelect}
          onClose={closeGlobe}
          status={status}
          onStatusChange={onStatusChange}
          windowH={windowH}
          onWindowChange={onWindowChange}
        />,
        document.body,
      )}
    </>
  );
}

function Inspector({ id, onSelect }: { id: string; onSelect: (id: string) => void }) {
  const [tab, setTab] = useState<"details" | "rdf">("details");
  const n = nodeById(id);
  const out = EDGES.filter((e) => e.source === id);
  const inn = EDGES.filter((e) => e.target === id);
  const Rel = ({ e, dir }: { e: (typeof EDGES)[number]; dir: "out" | "in" }) => {
    const other = nodeById(dir === "out" ? e.target : e.source);
    return (
      <div className="rounded-[10px] border hairline bg-black/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => onSelect(other.id)} className="min-w-0 truncate text-left text-[12.5px] text-fg hover:text-[#9db8f5]">
            <span className="num text-[11px] text-[#b9aef7]">{dir === "out" ? `${e.rel} →` : `← ${e.rel}`}</span> {other.label}
          </button>
          <Badge tone={e.status === "verified" ? "emerald" : "amber"} dot>
            {e.status}
          </Badge>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-fg-3">
          <span className="truncate">{e.evidence}</span>
          <span className="num shrink-0 pl-2">
            conf {e.confidence.toFixed(2)} · {e.hoursAgo < 1 ? `${Math.round(e.hoursAgo * 60)}m` : `${Math.round(e.hoursAgo)}h`}
          </span>
        </div>
      </div>
    );
  };

  return (
    <Panel hover={false} tone="violet" className="flex max-h-[760px] flex-col self-start">
      <div className="px-5 pt-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: NODE_COLORS[n.type] }} />
          <span className="eyebrow">{n.type}</span>
        </div>
        <h3 className="mt-1.5 text-[18px] font-medium text-fg">{n.label}</h3>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg-2">{n.description}</p>
      </div>
      <div className="mt-4 px-4">
        <Tabs
          id="insp"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "details", label: "Details" },
            { key: "rdf", label: "RDF" },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
        {tab === "details" ? (
          <div className="space-y-5">
            <div>
              <div className="eyebrow mb-2">Properties</div>
              <div className="divide-y divide-white/[0.06]">
                {Object.entries(n.props).map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1.5 text-[12.5px]">
                    <span className="text-fg-3">{k}</span>
                    <span className="num text-fg">{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="eyebrow mb-2">Relationships · {out.length + inn.length}</div>
              <div className="space-y-2">
                {out.map((e) => (
                  <Rel key={e.id} e={e} dir="out" />
                ))}
                {inn.map((e) => (
                  <Rel key={e.id} e={e} dir="in" />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <pre className="num overflow-x-auto whitespace-pre text-[11px] leading-[1.7] text-fg-2">{toTurtle(id)}</pre>
        )}
      </div>
    </Panel>
  );
}

function Sparql({ onShow }: { onShow: (id: string) => void }) {
  const [query, setQuery] = useState(SPARQL_PRESETS[0].query);
  const [res, setRes] = useState(() => runSparql(SPARQL_PRESETS[0].query));
  const run = (q = query) => setRes(runSparql(q));
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel hover={false}>
        <PanelHeader eyebrow="SPARQL console" title="Query the graph" action={<Button variant="primary" onClick={() => run()}><Play size={12} /> Run</Button>} />
        <div className="flex flex-wrap gap-1.5 px-5 pb-3">
          {SPARQL_PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => {
                setQuery(p.query);
                run(p.query);
              }}
              className={cn("rounded-full border px-2.5 py-1 text-[11.5px] transition-colors", query === p.query ? "border-accent/35 bg-accent/10 text-[#9db8f5]" : "border-white/8 text-fg-3 hover:text-fg-2")}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="px-4 pb-4">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") run();
            }}
            spellCheck={false}
            className="num h-[290px] w-full resize-none rounded-[12px] border hairline bg-black/35 p-4 text-[12.5px] leading-[1.7] text-[#b9c6e8] outline-none focus:border-accent/40"
          />
          <div className="mt-2 text-[11px] text-fg-3">Ctrl + Enter to run. Basic graph patterns over the illustrative triple store.</div>
        </div>
      </Panel>
      <Panel hover={false}>
        <PanelHeader eyebrow="Results" title={res.error ? "Query error" : `${res.rows.length} solution${res.rows.length === 1 ? "" : "s"}`} />
        <div className="px-3 pb-4">
          {res.error ? (
            <div className="mx-2 rounded-[10px] border border-down/30 bg-down/10 p-3 text-[12.5px] text-[#ec8696]">{res.error}</div>
          ) : (
            <table className="num w-full text-[12px]">
              <thead>
                <tr className="text-left text-fg-3">
                  {res.vars.map((v) => (
                    <th key={v} className="px-3 py-2 font-normal">
                      {v}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {res.rows.map((r, i) => (
                  <tr key={i} className="border-t hairline">
                    {res.vars.map((v) => (
                      <td key={v} className="px-3 py-2.5">
                        <button onClick={() => r[v].startsWith(":") && NODES.some((n) => `:${n.id}` === r[v]) && onShow(r[v].slice(1))} className="text-fg hover:text-[#9db8f5]">
                          {r[v]}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
                {!res.rows.length && (
                  <tr>
                    <td colSpan={Math.max(res.vars.length, 1)} className="px-3 py-8 text-center text-fg-3">
                      No matching triples.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </Panel>
    </div>
  );
}

export default function KnowledgeGraph() {
  const [view, setView] = useState<View>("explore");
  const [selected, setSelected] = useState("btc");
  const [relations, setRelations] = useState<Set<string>>(new Set(RELATION_TYPES));
  const [status, setStatus] = useState<StatusFilter>("all");
  const [windowH, setWindowH] = useState<Window>("all");

  const toggleRel = (r: string) =>
    setRelations((s) => {
      const n = new Set(s);
      if (n.has(r)) n.delete(r);
      else n.add(r);
      return n;
    });

  return (
    <>
      <PageHeader
        eyebrow="Semantic knowledge graph"
        title="How the world connects"
        description="This is a seeded illustrative graph, not live market, on-chain or news data. Its example edges are marked verified or inferred to demonstrate the interface."
        actions={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { key: "explore", label: "Explorer" },
              { key: "sparql", label: "SPARQL" },
            ]}
          />
        }
      />

      {view === "sparql" ? (
        <Sparql
          onShow={(id) => {
            setSelected(id);
            setView("explore");
          }}
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_350px]">
          <Panel hover={false} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b hairline px-5 py-3">
              <div className="flex items-center gap-3">
                <Segmented
                  size="sm"
                  value={status}
                  onChange={setStatus}
                  options={[
                    { key: "all", label: "All" },
                    { key: "verified", label: "Verified" },
                    { key: "inferred", label: "Inferred" },
                  ]}
                />
                <Segmented
                  size="sm"
                  value={windowH}
                  onChange={setWindowH}
                  options={[
                    { key: "1", label: "1h" },
                    { key: "6", label: "6h" },
                    { key: "24", label: "24h" },
                    { key: "all", label: "All time" },
                  ]}
                />
              </div>
              <div className="flex items-center gap-4 text-[11px] text-fg-3">
                <span className="flex items-center gap-1.5">
                  <svg width="22" height="6"><line x1="0" x2="22" y1="3" y2="3" stroke="rgba(163,171,187,0.7)" /></svg>Verified
                </span>
                <span className="flex items-center gap-1.5">
                  <svg width="22" height="6"><line x1="0" x2="22" y1="3" y2="3" stroke="#d6a24a" strokeDasharray="3 3" /></svg>Inferred
                </span>
              </div>
            </div>
            <div className="relative bg-[radial-gradient(ellipse_at_center,rgba(149,133,242,0.06),transparent_65%)] p-2">
              <Graph
                selected={selected}
                onSelect={setSelected}
                relations={relations}
                status={status}
                onStatusChange={setStatus}
                windowH={windowH}
                onWindowChange={setWindowH}
              />
            </div>
            <div className="space-y-3 border-t hairline px-5 py-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {(Object.keys(NODE_COLORS) as NodeType[]).map((t) => (
                  <span key={t} className="flex items-center gap-1.5 text-[11px] text-fg-3">
                    <span className="h-2 w-2 rounded-full" style={{ background: NODE_COLORS[t] }} />
                    {t}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {RELATION_TYPES.map((r) => (
                  <button
                    key={r}
                    onClick={() => toggleRel(r)}
                    aria-pressed={relations.has(r)}
                    className={cn("num rounded-full border px-2 py-0.5 text-[10.5px] transition-colors", relations.has(r) ? "border-violet/35 bg-violet/10 text-[#b9aef7]" : "border-white/8 text-fg-4 hover:text-fg-3")}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </Panel>
          <Inspector id={selected} onSelect={setSelected} />
        </div>
      )}
    </>
  );
}
