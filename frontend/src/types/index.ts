export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number | null
  modified: number
  extension: string | null
}

export interface FileDetection {
  path: string
  name: string
  file_type: string
  parquet_role?: string
  suggested_actions: string[]
  lineage_bundle?: LineageBundle
}

export interface ParquetColumn {
  name: string
  dtype: string
}

export interface ParquetSchema {
  columns: ParquetColumn[]
  row_count: number
  file_size: number
}

export interface ParquetPage {
  rows: Record<string, unknown>[]
  columns: string[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface LineageBundle {
  folder: string
  processes: string
  edges: string
  manifest: string | null
}

export interface LineageSummary {
  total_processes: number
  total_edges: number
  unique_databases: number
  unique_schemas: number
  unique_tables: number
  unique_columns: number
  system_names: string[]
  confidence_distribution: Record<string, number>
  transform_type_distribution: Record<string, number>
  edge_direction_distribution: Record<string, number>
  resolution_type_distribution: Record<string, number>
  source_type_distribution: Record<string, number>
  target_type_distribution: Record<string, number>
  query_type_distribution: Record<string, number>
  manifest: Record<string, unknown> | null
}

export interface AssetTable {
  table: string
  column_count: number
  columns: string[]
  as_source: number
  as_target: number
  source_process_count: number
  target_process_count: number
}

export interface AssetSchema {
  schema: string
  table_count: number
  tables: AssetTable[]
}

export interface AssetDatabase {
  database: string
  schema_count: number
  table_count: number
  schemas: AssetSchema[]
}

export interface EdgeRow {
  edge_id: string
  edge: string
  source_fqn: string
  source_type: string
  target_fqn: string
  target_type: string
  process_fqn: string
  transform_type: string
  expression: string
  confidence: string
  resolution_type: string
  is_temporary_source: boolean | string
  is_temporary_target: boolean | string
}

export interface EdgePage {
  rows: EdgeRow[]
  total: number
  page: number
  page_size: number
  total_pages: number
  confidence_options: string[]
  transform_options: string[]
  direction_options: string[]
  source_type_options: string[]
  target_type_options: string[]
}

export type SortDirection = 'asc' | 'desc'

export interface ProcessRecord {
  process_fqn: string
  process_name: string
  process_type: string
  process_code: string
  query_type: string
  last_seen_at: string
}

export interface LineageGraphNode {
  id: string
  type: 'table' | 'process'
  label: string
  full_name?: string
  /** Table nodes only: the pipeline tags this object as a view rather than a table. */
  is_view?: boolean
  process_fqn?: string
  query_type?: string | null
  process_code?: string | null
}

export interface LineageGraphEdge {
  source: string
  target: string
  /** input = table→process (read), output = process→table (write), mapping = table/view→table/view via maps_to. */
  kind: 'input' | 'output' | 'mapping'
  /** Mapping edges only: how many column-to-column mappings back this link (0 = a table-level link only). */
  column_count?: number
}

/** `all` = tables, views and the processes between them; `mapping` = only table/view → table/view links from maps_to edges. */
export type GraphMode = 'all' | 'mapping'

export interface LineageGraph {
  nodes: LineageGraphNode[]
  edges: LineageGraphEdge[]
}

export interface Snippet {
  id: string
  title: string
  content: string
}

export interface SnippetGroup {
  id: string
  title: string
  snippets: Snippet[]
}

export interface SnippetCollection {
  id: string
  title: string
  groups: SnippetGroup[]
  snippets: Snippet[]
}

export interface OkfSummary {
  databases: number
  schemas: number
  tables: number
  views: number
  columns: number
}

export interface OkfAssetRef {
  name: string
  type: 'table' | 'view'
  status: string
  tags: string[]
  column_count: number
  path: string
}

export interface OkfSchemaNode {
  schema: string
  owner?: string | null
  assets: OkfAssetRef[]
}

export interface OkfDatabaseNode {
  database: string
  schemas: OkfSchemaNode[]
}

export interface OkfReviewQueue {
  blocked: string[]
  events: string[]
}

export interface OkfHistoryEntry {
  date: string
  kind: string
  summary: string
  details: string[]
}

export interface OkfCatalog {
  found: boolean
  connection_id?: string
  generated_at?: string
  summary?: OkfSummary
  databases?: OkfDatabaseNode[]
  review_queue?: OkfReviewQueue
  history?: OkfHistoryEntry[]
}

export interface OkfAssetLink {
  name: string
  path: string
}

export interface OkfColumnRef {
  asset: string
  column: string
  path: string
  confidence?: string
}

export interface OkfColumnDetail {
  name: string
  type: string
  transform?: string | null
  expression?: string | null
  sources: OkfColumnRef[]
  used_in: OkfColumnRef[]
}

export interface OkfProcessBlock {
  query_type: string
  process_id: string
  last_seen: string
  sql: string
}

export interface OkfAssetDetail {
  name: string
  type: 'table' | 'view'
  status: string
  description?: string | null
  owner?: string | null
  tags: string[]
  created_at?: string | null
  fqn: string
  database: string
  schema: string
  column_count: number
  upstream: OkfAssetLink[]
  downstream: OkfAssetLink[]
  columns: OkfColumnDetail[]
  primary_key?: string | null
  written_by: OkfProcessBlock[]
  read_by: OkfProcessBlock[]
  business_context?: string | null
  data_quality?: string | null
}

export type ViewMode =
  | 'view_table'
  | 'convert_to_json'
  | 'analyze_lineage'
  | 'view_json'
  | 'edit_markdown'
  | 'view_text'
  | 'browse'
  | null
