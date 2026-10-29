import { useState } from 'react'
import { Table2, Layers, Copy, Check, ChevronDown, ChevronRight, KeyRound, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import FqnCell from '../../viewers/FqnCell'
import { confidenceColor, queryTypeBadge } from '../../../utils/format'
import type { OkfAssetDetail, OkfColumnRef, OkfProcessBlock } from '../../../types'

interface Props {
  asset: OkfAssetDetail
  onNavigate: (path: string) => void
}

function LinkChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
    >
      {label}
    </button>
  )
}

function ColumnRefChips({ refs, onNavigate }: { refs: OkfColumnRef[]; onNavigate: (path: string) => void }) {
  if (!refs.length) return <span className="text-slate-300 dark:text-slate-700">—</span>
  return (
    <div className="flex flex-wrap gap-1.5">
      {refs.map((r, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <button
            onClick={() => onNavigate(r.path)}
            className="font-mono text-[11px] text-indigo-700 dark:text-indigo-300 hover:underline"
          >
            {r.asset}.{r.column}
          </button>
          {r.confidence && (
            <span className={`text-[9px] px-1 rounded ${confidenceColor(r.confidence)}`}>{r.confidence}</span>
          )}
        </span>
      ))}
    </div>
  )
}

function ProcessBlockCard({ block }: { block: OkfProcessBlock }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyId = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(block.process_id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="bg-slate-100/60 dark:bg-slate-800/40 border border-slate-300 dark:border-slate-700 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 transition-colors text-left">
        {open ? <ChevronDown size={12} className="text-slate-500 shrink-0" /> : <ChevronRight size={12} className="text-slate-500 shrink-0" />}
        <span className={`text-xs px-2 py-0.5 rounded border shrink-0 ${queryTypeBadge(block.query_type)}`}>{block.query_type}</span>
        <span className="font-mono text-[11px] text-slate-500 truncate">{block.process_id}</span>
        <button onClick={copyId} title="Copy process id" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 shrink-0">
          {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
        </button>
        <span className="text-[11px] text-slate-400 ml-auto shrink-0">{block.last_seen}</span>
      </button>
      {open && (
        <pre className="px-3 py-2.5 text-xs font-mono text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/60 overflow-x-auto whitespace-pre-wrap leading-relaxed border-t border-slate-300 dark:border-slate-700">
          {block.sql}
        </pre>
      )}
    </div>
  )
}

export default function AssetDetail({ asset, onNavigate }: Props) {
  const Icon = asset.type === 'view' ? Layers : Table2

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Icon size={16} className={asset.type === 'view' ? 'text-teal-600 dark:text-teal-400' : 'text-cyan-700 dark:text-cyan-400'} />
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 font-mono">{asset.name}</h2>
          <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${asset.type === 'view' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' : 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300'}`}>
            {asset.type}
          </span>
          {asset.status && asset.status.toLowerCase() !== 'stable' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">{asset.status}</span>
          )}
        </div>
        {asset.description && <p className="text-sm text-slate-600 dark:text-slate-400 mb-2 max-w-2xl">{asset.description}</p>}
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          {asset.owner && <span>Owner: <span className="text-slate-700 dark:text-slate-300">{asset.owner}</span></span>}
          {asset.created_at && <span>Created: <span className="text-slate-700 dark:text-slate-300">{asset.created_at}</span></span>}
          <span>{asset.column_count} columns</span>
        </div>
        {asset.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {asset.tags.map(t => (
              <span key={t} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">{t}</span>
            ))}
          </div>
        )}
        {asset.fqn && <div className="mt-2"><FqnCell value={asset.fqn} truncate={false} /></div>}
      </div>

      {/* Table lineage */}
      {(asset.upstream.length > 0 || asset.downstream.length > 0) && (
        <div>
          <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Table Lineage</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 mb-1.5"><ArrowUpRight size={12} /> Upstream</div>
              {asset.upstream.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {asset.upstream.map(u => <LinkChip key={u.path} label={u.name} onClick={() => onNavigate(u.path)} />)}
                </div>
              ) : <span className="text-slate-400 italic text-xs">none</span>}
            </div>
            <div>
              <div className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 mb-1.5"><ArrowDownRight size={12} /> Downstream</div>
              {asset.downstream.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {asset.downstream.map(d => <LinkChip key={d.path} label={d.name} onClick={() => onNavigate(d.path)} />)}
                </div>
              ) : <span className="text-slate-400 italic text-xs">none</span>}
            </div>
          </div>
        </div>
      )}

      {/* Primary key */}
      {asset.primary_key && (
        <div className="flex items-center gap-1.5 text-xs">
          <KeyRound size={12} className="text-amber-500" />
          <span className="text-slate-500">Primary Key:</span>
          <span className="font-mono text-slate-700 dark:text-slate-300">{asset.primary_key}</span>
        </div>
      )}

      {/* Column details */}
      {asset.columns.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Column Details</h3>
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-100/80 dark:bg-slate-900/50">
                <tr className="text-left text-slate-500">
                  <th className="px-3 py-2 font-medium">Column</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Transform</th>
                  <th className="px-3 py-2 font-medium">Source (upstream)</th>
                  <th className="px-3 py-2 font-medium">Used in (downstream)</th>
                </tr>
              </thead>
              <tbody>
                {asset.columns.map(col => (
                  <tr key={col.name} className="border-t border-slate-100 dark:border-slate-800/60">
                    <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">{col.name}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{col.type}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {col.transform ? (
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">{col.transform}</span>
                      ) : <span className="text-slate-300 dark:text-slate-700">—</span>}
                    </td>
                    <td className="px-3 py-2"><ColumnRefChips refs={col.sources} onNavigate={onNavigate} /></td>
                    <td className="px-3 py-2"><ColumnRefChips refs={col.used_in} onNavigate={onNavigate} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Written by / Read by */}
      {asset.written_by.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Written by ({asset.written_by.length})</h3>
          <div className="space-y-2">
            {asset.written_by.map((b, i) => <ProcessBlockCard key={b.process_id + i} block={b} />)}
          </div>
        </div>
      )}
      {asset.read_by.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Read by ({asset.read_by.length})</h3>
          <div className="space-y-2">
            {asset.read_by.map((b, i) => <ProcessBlockCard key={b.process_id + i} block={b} />)}
          </div>
        </div>
      )}

      {asset.business_context && (
        <div>
          <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Business Context</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">{asset.business_context}</p>
        </div>
      )}
      {asset.data_quality && (
        <div>
          <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Data Quality</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">{asset.data_quality}</p>
        </div>
      )}
    </div>
  )
}
