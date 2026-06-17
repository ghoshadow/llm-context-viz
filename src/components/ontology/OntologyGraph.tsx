import React, { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import type { OntologyType, OntologyNode, OntologyEdge } from '../../types/ontology';

// ─── Internal D3 types ──────────────────────────────────────────────────────

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: string;
  conf: number;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  label: string;
  conf: number;
}

// ─── Color map from type keys ───────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  mechanism: 'oklch(0.74 0.12 165)',
  agent: 'oklch(0.78 0.13 60)',
  system: 'oklch(0.70 0.13 245)',
};

// ─── Props ─────────────────────────────────────────────────────────────────

interface OntologyGraphProps {
  data: { types: OntologyType[]; nodes: OntologyNode[]; edges: OntologyEdge[] };
  selectedNodeId: string | null;
  turn: number;
  activeTypes: Record<string, boolean>;
  onSelectNode: (id: string | null) => void;
  recenterKey: number;
}

// ─── Component ─────────────────────────────────────────────────────────────

const OntologyGraph: React.FC<OntologyGraphProps> = ({
  data,
  selectedNodeId,
  turn,
  activeTypes,
  onSelectNode,
  recenterKey,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const groupsRef = useRef<{
    gZoom: d3.Selection<SVGGElement, unknown, null, undefined>;
    gLink: d3.Selection<SVGGElement, unknown, null, undefined>;
    gLabel: d3.Selection<SVGGElement, unknown, null, undefined>;
    gNode: d3.Selection<SVGGElement, unknown, null, undefined>;
    zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;
  } | null>(null);

  const containerSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  // Build colorMap from data.types (fall back to type's own color if not in preset)
  const colorMap: Record<string, string> = {};
  data.types.forEach((t) => {
    colorMap[t.key] = TYPE_COLORS[t.key] || t.color;
  });

  // Compute degree from edges
  const degree: Record<string, number> = {};
  data.nodes.forEach((n) => (degree[n.id] = 0));
  data.edges.forEach((e) => {
    degree[e.s] = (degree[e.s] || 0) + 1;
    degree[e.t] = (degree[e.t] || 0) + 1;
  });

  // Radius function
  const radius = useCallback(
    (d: { id: string; conf: number }) =>
      8 + d.conf * 9 + Math.min(9, (degree[d.id] || 0) * 0.9),
    [degree],
  );

  // ─── autoFit ─────────────────────────────────────────────────────────────

  const autoFit = useCallback(
    (dur = 520) => {
      const sim = simRef.current;
      const grp = groupsRef.current;
      if (!sim || !grp || !svgRef.current) return;

      const ns = sim.nodes();
      if (!ns.length) return;

      const { w: cw, h: ch } = containerSizeRef.current;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      ns.forEach((n) => {
        const r = radius(n as { id: string; conf: number }) + 22;
        minX = Math.min(minX, n.x! - r);
        maxX = Math.max(maxX, n.x! + r);
        minY = Math.min(minY, n.y! - r);
        maxY = Math.max(maxY, n.y! + r);
      });

      const bw = Math.max(1, maxX - minX);
      const bh = Math.max(1, maxY - minY);
      const scale = Math.min(2.0, Math.max(0.3, 0.95 * Math.min(cw / bw, ch / bh)));
      const tx = cw / 2 - scale * (minX + maxX) / 2;
      const ty = ch / 2 - scale * (minY + maxY) / 2;
      const tr = d3.zoomIdentity.translate(tx, ty).scale(scale);

      const svg = d3.select(svgRef.current);
      if (dur > 0) {
        svg.transition().duration(dur).call(grp.zoom.transform, tr);
      } else {
        svg.call(grp.zoom.transform, tr);
      }
    },
    [radius],
  );

  // ─── Mount: init D3 simulation, zoom, drag, ResizeObserver ──────────────

  useEffect(() => {
    const svgEl = svgRef.current;
    const containerEl = containerRef.current;
    if (!svgEl || !containerEl) return;

    const measure = () => {
      const r = containerEl.getBoundingClientRect();
      containerSizeRef.current = { w: r.width, h: r.height };
    };
    measure();

    const svg = d3.select(svgEl);
    svg.style('cursor', 'grab');
    svg.on('mousedown', function () { d3.select(this).style('cursor', 'grabbing'); });
    svg.on('mouseup', function () { d3.select(this).style('cursor', 'grab'); });
    svg.on('click', () => onSelectNode(null));

    // Zoom group
    const gZoom = svg.append('g');
    const gLink = gZoom.append('g').attr('stroke-linecap', 'round');
    const gLabel = gZoom.append('g');
    const gNode = gZoom.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (ev) => { gZoom.attr('transform', ev.transform); });

    svg.call(zoom);

    // Drag behavior
    const drag = d3.drag<SVGGElement, SimNode>()
      .on('start', (ev, d) => {
        if (!ev.active) simRef.current?.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on('end', (ev, d) => {
        if (!ev.active) simRef.current?.alphaTarget(0);
        d.fx = null as unknown as number; d.fy = null as unknown as number;
      });

    // Tick handler
    const tick = () => {
      gLink.selectAll<SVGLineElement, SimLink>('line')
        .attr('x1', (d: any) => (d.source as SimNode).x!)
        .attr('y1', (d: any) => (d.source as SimNode).y!)
        .attr('x2', (d: any) => (d.target as SimNode).x!)
        .attr('y2', (d: any) => (d.target as SimNode).y!);

      gLabel.selectAll<SVGTextElement, SimLink>('text')
        .attr('x', (d: any) => ((d.source as SimNode).x! + (d.target as SimNode).x!) / 2)
        .attr('y', (d: any) => ((d.source as SimNode).y! + (d.target as SimNode).y!) / 2 - 3);

      gNode.selectAll<SVGGElement, SimNode>('g.gnode')
        .attr('transform', (d) => `translate(${d.x},${d.y})`);

      // Save positions
      simRef.current?.nodes().forEach((n) => {
        posRef.current.set((n as SimNode).id, { x: n.x!, y: n.y! });
      });
    };

    // Force simulation
    const { w, h } = containerSizeRef.current;
    const sim = d3.forceSimulation<SimNode>()
      .force('link', d3.forceLink<SimNode, SimLink>()
        .id((d) => d.id)
        .distance((d) => 64 - d.conf * 12)
        .strength((d) => 0.3 + d.conf * 0.4))
      .force('charge', d3.forceManyBody().strength(-210))
      .force('center', d3.forceCenter(w / 2, h / 2))
      .force('x', d3.forceX(w / 2).strength(0.06))
      .force('y', d3.forceY(h / 2).strength(0.06))
      .force('collide', d3.forceCollide<SimNode>().radius((d) => radius(d) + 12))
      .on('tick', tick);

    simRef.current = sim;
    groupsRef.current = { gZoom, gLink, gLabel, gNode, zoom };

    // ResizeObserver
    const ro = new ResizeObserver(() => {
      measure();
      const { w: nw, h: nh } = containerSizeRef.current;
      sim
        .force('center', d3.forceCenter(nw / 2, nh / 2))
        .force('x', d3.forceX(nw / 2).strength(0.06))
        .force('y', d3.forceY(nh / 2).strength(0.06));
      autoFit(0);
    });
    ro.observe(containerEl);

    return () => {
      sim.stop();
      ro.disconnect();
      svg.on('mousedown', null).on('mouseup', null).on('click', null);
      svg.selectAll('*').remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Update: data binding ──────────────────────────────────────────────

  useEffect(() => {
    const sim = simRef.current;
    const grp = groupsRef.current;
    if (!sim || !grp) return;

    const { w, h } = containerSizeRef.current;

    // --- Filter visible nodes and edges ---
    const visibleNodes = data.nodes.filter(
      (n) => activeTypes[n.type] !== false && n.firstTurn <= turn,
    );
    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = data.edges.filter(
      (e) => e.firstTurn <= turn && visibleIds.has(e.s) && visibleIds.has(e.t),
    );

    // --- Neighbor set for highlight ---
    const neighborSet = new Set<string>();
    if (selectedNodeId) {
      neighborSet.add(selectedNodeId);
      visibleEdges.forEach((e) => {
        if (e.s === selectedNodeId) neighborSet.add(e.t);
        if (e.t === selectedNodeId) neighborSet.add(e.s);
      });
    }
    const dim = (id: string) => selectedNodeId !== null && !neighborSet.has(id);

    // --- Build SimNode / SimLink arrays ---
    const simNodes: SimNode[] = visibleNodes.map((n) => {
      const prev = posRef.current.get(n.id);
      return {
        id: n.id, label: n.label, type: n.type, conf: n.conf,
        x: prev ? prev.x : w / 2 + (Math.random() - 0.5) * 260,
        y: prev ? prev.y : h / 2 + (Math.random() - 0.5) * 260,
      };
    });

    const simEdges: SimLink[] = visibleEdges.map((e) => ({
      source: e.s, target: e.t, label: e.label, conf: e.conf,
    }));

    // --- Link elements ---
    const linkSel = grp.gLink
      .selectAll<SVGLineElement, SimLink>('line')
      .data(simEdges, (d: any) => d.s + '>' + d.t);

    linkSel.exit().remove();
    const linkEnter = linkSel.enter().append('line').attr('stroke', 'oklch(0.55 0.02 265)');

    linkEnter.merge(linkSel)
      .attr('stroke-width', (d) => 0.7 + d.conf * 1.5)
      .attr('stroke', (d: any) => {
        if (selectedNodeId && (d.s === selectedNodeId || d.t === selectedNodeId))
          return 'oklch(0.80 0.10 165)';
        return 'oklch(0.50 0.02 265)';
      })
      .attr('stroke-opacity', (d: any) => {
        if (selectedNodeId)
          return (d.s === selectedNodeId || d.t === selectedNodeId) ? 0.9 : 0.05;
        return 0.32;
      });

    // --- Link labels (only shown when a node is selected) ---
    const labelData = selectedNodeId
      ? simEdges.filter((e: any) => e.s === selectedNodeId || e.t === selectedNodeId)
      : [];

    const labelSel = grp.gLabel
      .selectAll<SVGTextElement, SimLink>('text')
      .data(labelData, (d: any) => d.s + '>' + d.t);

    labelSel.exit().remove();

    const labelEnter = labelSel.enter()
      .append('text')
      .attr('font-family', "'IBM Plex Sans', sans-serif")
      .attr('font-size', 9.5)
      .attr('fill', 'oklch(0.74 0.06 165)')
      .attr('text-anchor', 'middle')
      .attr('paint-order', 'stroke')
      .attr('stroke', 'oklch(0.16 0.008 265)')
      .attr('stroke-width', 3);

    labelEnter.merge(labelSel).text((d) => d.label);

    // --- Node elements ---
    const drag = d3.drag<SVGGElement, SimNode>()
      .on('start', (ev, d) => {
        if (!ev.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on('end', (ev, d) => {
        if (!ev.active) sim.alphaTarget(0);
        d.fx = null as unknown as number; d.fy = null as unknown as number;
      });

    const nodeSel = grp.gNode
      .selectAll<SVGGElement, SimNode>('g.gnode')
      .data(simNodes, (d) => d.id);

    nodeSel.exit().remove();

    const nodeEnter = nodeSel.enter()
      .append('g')
      .attr('class', 'gnode')
      .style('cursor', 'pointer')
      .call(drag)
      .on('click', (ev, d) => { ev.stopPropagation(); onSelectNode(d.id); });

    nodeEnter.append('circle');
    nodeEnter.append('text')
      .attr('text-anchor', 'middle')
      .attr('font-family', "'IBM Plex Sans', sans-serif");

    const nodeMerge = nodeEnter.merge(nodeSel);

    nodeMerge.select('circle')
      .attr('r', (d) => radius(d))
      .attr('fill', (d) => colorMap[d.type] || 'oklch(0.60 0.05 265)')
      .attr('stroke', (d) =>
        d.id === selectedNodeId ? 'oklch(0.98 0 0)' : 'oklch(0.16 0.01 265 / 0.7)')
      .attr('stroke-width', (d) => (d.id === selectedNodeId ? 2.5 : 1))
      .attr('opacity', (d) => (dim(d.id) ? 0.16 : 1));

    nodeMerge.select('text')
      .text((d) => d.label)
      .attr('y', (d) => radius(d) + 12.5)
      .attr('font-size', (d) => 9.5 + Math.min(2.5, (degree[d.id] || 0) * 0.18))
      .attr('font-weight', (d) => (d.id === selectedNodeId ? 600 : 400))
      .attr('fill', (d) =>
        dim(d.id) ? 'oklch(0.55 0.01 265 / 0.35)' : 'oklch(0.90 0.006 265)')
      .attr('paint-order', 'stroke')
      .attr('stroke', 'oklch(0.17 0.008 265 / 0.92)')
      .attr('stroke-width', 3.2);

    // --- Restart simulation ---
    sim.nodes(simNodes);
    (sim.force('link') as d3.ForceLink<SimNode, SimLink>).links(simEdges);
    sim.alpha(0.55).restart();

    // Auto-fit after initial draw
    setTimeout(() => autoFit(0), 750);
    setTimeout(() => autoFit(0), 1700);
  }, [data, selectedNodeId, turn, activeTypes, recenterKey, radius, autoFit, onSelectNode, colorMap, degree]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <svg ref={svgRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
};

export default OntologyGraph;
