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
  /** Only for bundles with Power BI assets; the database counts above leave these out. */
  bi_assets?: { models: number; reports: number; dashboards: number; tiles: number; tables: number; fields: number; measures: number; dataflows?: number }
  /** What the data calls each of those kinds (a path's kind segment, or the source_type/target_type tag): the cards are labelled with these. */
  bi_asset_type_names?: Partial<Record<'models' | 'reports' | 'dashboards' | 'tiles' | 'tables' | 'fields' | 'measures' | 'dataflows', string>>
  manifest: Record<string, unknown> | null
}

export interface AssetTable {
  table: string
  /** Power BI only, when the crawl names it: the name of a report or tile (`table` is its id). */
  table_label?: string
  column_count: number
  columns: string[]
  /** Power BI model: what each of its `columns` is. */
  column_kinds?: Record<string, 'field' | 'measure'>
  /** Power BI model: how a column is really written, when the scan names it ("Table[Column]" for a field). */
  column_labels?: Record<string, string>
  /** Power BI model: what the data calls a field and a measure. */
  type_names?: { field?: string; measure?: string }
  as_source: number
  as_target: number
  source_process_count: number
  target_process_count: number
}

export interface AssetSchema {
  schema: string
  /** Power BI only, when the crawl names it: the name of a model or dashboard (`schema` is its id). */
  schema_label?: string
  table_count: number
  tables: AssetTable[]
}

export interface AssetDatabase {
  database: string
  schema_count: number
  table_count: number
  schemas: AssetSchema[]
}

/** One row of edges.parquet: every column of the file, under the file's own names (an empty value is ""). */
export type EdgeRow = Record<string, string | number | boolean | null>

export interface EdgePage {
  /** Every column of the file, in its order. */
  columns: string[]
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

export type BiAssetType = 'bitable' | 'bimodel' | 'bireport' | 'bitile' | 'bidashboard' | 'bidataflow'

export interface LineageGraphNode {
  id: string
  type: 'table' | 'process' | 'stored_procedure' | 'bi_member'
  label: string
  /** Tables: `database.schema.table`. Stored procedures: `database.schema.name`. */
  full_name?: string
  /** Table nodes only: the pipeline tags this object as a view rather than a table. */
  is_view?: boolean
  /**
   * Table nodes only, Power BI assets: a data table (`bitable`, its fields roll up into it), a model
   * (`bimodel`, its measures roll up into it), a report, a dashboard or a dashboard tile. Absent for database objects.
   */
  asset_type?: BiAssetType
  /** Power BI nodes the crawl knows: what tells same-named assets apart (workspace, dashboard, model). */
  details?: { label: string; value: string }[]
  process_fqn?: string
  process_type?: string | null
  query_type?: string | null
  process_code?: string | null
  /**
   * The node this one is drawn inside, when opened. A process: the stored_procedure node that ran it (null for a process
   * with no procedure). A `bi_member`: the model node it is part of.
   */
  parent_id?: string | null
  /**
   * `bi_member` nodes only: something inside a Power BI model, drawn inside the model's box: a measure or field that
   * is linked to others, or a table (with or without any links). `label` is its name, `details` says which model it is in.
   */
  member_kind?: 'measure' | 'field' | 'table'
  /**
   * What the data calls this kind of Power BI asset: the kind segment of a live-scanner path (semantic_model, semantic_table,
   * report, dashboard, tile, field, measure) or the source_type/target_type tag (bimodel, ...). The screen shows these names and
   * no others; absent for a database table or view.
   */
  type_name?: string
  /** A field or measure: what the data calls the table it lives in (`table` is its name). */
  table_type_name?: string
  /** A table of a model: what the data calls the fields and measures it holds. */
  member_type_names?: { field?: string; measure?: string }
  /** Members of a model: the id of the model they belong to. */
  model_id?: string
  /** Measures and fields only: the table of the model it lives in. */
  table?: string
  /** Tables only: how many fields and measures the table holds, and the first few names of each. */
  field_count?: number
  measure_count?: number
  fields?: string[]
  measures?: string[]
  /** Stored-procedure nodes only: the procedure's FQN; its last segment is `label`. */
  fqn?: string
}

/**
 * What some of a drawn link's data edges say about themselves: how many say the same `confidence`, `resolution_type` and
 * `fallback_reason` (any the data leaves empty is left out). A link may stand for many edges, e.g. the one between two
 * closed models is the roll-up of all their table and field edges.
 */
export interface ConfidenceBasis {
  confidence?: string
  resolution_type?: string
  fallback_reason?: string
  count: number
}

/** What the data says about one edge. */
export type EdgeSays = Omit<ConfidenceBasis, 'count'>

export interface LineageGraphEdge {
  source: string
  target: string
  /**
   * input = table→process (read), output = process→table (write), mapping = table/view→table/view via maps_to
   * (data-mapping mode), direct = the same maps_to link drawn inside the full graph for a view, which has no
   * process to route through, calls = stored procedure → stored procedure it invokes, uses = Power BI asset →
   * asset built on it (source table → model, data table → model, model → report/tile, report → tile, and, between
   * two `bi_member`s, a field or measure → the measure that is evaluated from it).
   */
  kind: 'input' | 'output' | 'mapping' | 'direct' | 'calls' | 'uses'
  /** Mapping edges only: how many column-to-column mappings back this link (0 = a table-level link only). */
  column_count?: number
  /**
   * A link between two whole assets (source table → model, model → model) that is only the roll-up of links between
   * the tables inside them (`uses` edges that end at a `bi_member` table). Drawn while the models are closed; left
   * out once one is open, because the table links are drawn instead.
   */
  summary?: boolean
  /** What the data edges behind this link say about how sure the pipeline is of them, weakest first (absent if they say nothing). */
  basis?: ConfidenceBasis[]
  /** The weakest `confidence` level among them, as the data writes it. */
  weakest?: string
}

/**
 * Where the Power BI names come from. `auto` = the crawl found next to the bundle, `manual` = the folder chosen by
 * hand, `bundle` = no crawl, but the bundle's own scanner result names its assets, `missing` = no crawl and no
 * scanner result, `invalid` = the chosen folder is not a crawl, `none` = the lineage has no Power BI assets.
 */
export interface BiNamesInfo {
  status: 'auto' | 'manual' | 'bundle' | 'missing' | 'invalid' | 'none'
  /** The crawl snapshot folder actually used (null unless `auto`/`manual`). */
  path: string | null
  /** The bundle's own scanner result (stage2/powerbi_scan_result.parquet), when it has one: it names whatever the crawl doesn't. */
  scan_path?: string | null
  message: string | null
  counts: { models: number; reports: number; dashboards: number; tiles: number } | null
}

/** One end of a path in a field's lineage: a database column, or a field of a Power BI model. */
export interface ColumnLineageNode {
  kind: 'column' | 'field'
  /** What the data calls it: `column` for a database column, the path's kind (`field`) for a field of a model. */
  type_name: string
  label: string
  /** The model a field belongs to (null for a database column). */
  model: string | null
  /**
   * What the data says about the edge that joins this node to the one on the field's side of it: the one that reads it,
   * in an upstream path, or the one it is read by, in a downstream path (so each arrow in a chain has one).
   */
  link?: EdgeSays
}

export interface ColumnLineageField {
  name: string
  /** Where it comes from: each path runs from the farthest source to the nearest one. */
  upstream: ColumnLineageNode[][]
  /** Where it goes: each path runs outward from the nearest. */
  downstream: ColumnLineageNode[][]
  /** The measures that read it directly. */
  measures?: { count: number; names: string[]; /** The weakest `confidence` among the edges to them. */ confidence?: string }
}

/** Where the fields of one table of a Power BI model come from and where they go. */
export interface ColumnLineage {
  model: { id: string; name: string }
  table: string
  /** What the data calls a table of a model and a field of it. */
  type_names?: { table?: string; field?: string }
  fields: ColumnLineageField[]
  /** Some field has more paths than were listed. */
  truncated: boolean
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
