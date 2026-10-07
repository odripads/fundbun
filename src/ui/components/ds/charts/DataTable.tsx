import type { ReactNode } from 'react'

export interface DataTableProps {
  caption: string
  columns: string[]
  rows: ReactNode[][]
}

/** The visually-hidden table twin every chart ships, so no value is reachable only by sight. */
export function DataTable({ caption, columns, rows }: DataTableProps) {
  return (
    // the wrapper does the hiding: tables ignore width/overflow and would widen the page
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => <th key={c} scope="col">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
