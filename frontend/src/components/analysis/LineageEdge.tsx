import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react'
import type { ConfidenceBasis, LineageGraphEdge } from '../../types'
import { linkTooltip } from '../../utils/confidence'

/** What a drawn link carries in its `data`. */
export type LineageEdgeData = {
  kind: LineageGraphEdge['kind']
  /** What the data edges behind the link say about their confidence (see ConfidenceBasis). */
  basis?: ConfidenceBasis[]
  /** The weakest `confidence` among them. */
  weakest?: string
}

/**
 * The default curved link, with a tooltip: its name in the data (read_by, writes_to, maps_to, calls) and what the data
 * says about how sure the pipeline is of it. The tooltip is the SVG's own <title>, which the browser shows on hover over
 * the link (or its wider invisible hit area), as it does for the title of a node.
 */
export default function LineageEdge(props: EdgeProps<Edge<LineageEdgeData>>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, style, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius, interactionWidth } = props
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return (
    <g>
      <title>{linkTooltip(data?.kind ?? 'uses', data?.basis)}</title>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={style}
        label={label}
        labelX={labelX}
        labelY={labelY}
        labelStyle={labelStyle}
        labelShowBg={labelShowBg}
        labelBgStyle={labelBgStyle}
        labelBgPadding={labelBgPadding}
        labelBgBorderRadius={labelBgBorderRadius}
        interactionWidth={interactionWidth}
      />
    </g>
  )
}
