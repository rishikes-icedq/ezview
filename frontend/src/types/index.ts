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
  process_fqn?: string
  query_type?: string | null
  process_code?: string | null
}

export interface LineageGraphEdge {
  source: string
  target: string
  kind: 'input' | 'output'
}

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

export type ViewMode =
  | 'view_table'
  | 'convert_to_json'
  | 'analyze_lineage'
  | 'view_json'
  | 'edit_markdown'
  | 'view_text'
  | 'browse'
  | null
