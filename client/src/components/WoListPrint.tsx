import type { WorkOrder, WoStatus } from '../lib/types';

/**
 * Printed "Work Order List" grouped by unit (A4 landscape), laid out like the paper template
 * Work_Order_List_Grouped_by_Unit.pdf and filled with the work orders of the list's current filters: a unit summary,
 * then one section per unit with one row per work order. Hidden on screen; shown by the Print button of the work
 * order list. Always English, like the template. WOS has no priority, so that column shows the type of maintenance.
 */

const STATUS: Record<WoStatus, string> = { OPEN: 'Open', ON_PROGRESS: 'On Progress', WAITING: 'Waiting', FINISH: 'Finish' };
const MAINTENANCE: Record<string, string> = { PREVENTIVE: 'Preventive', REPAIR: 'Repair', WARRANTY: 'Warranty', PDI: 'PDI', OTHERS: 'Others' };

const dt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '') : '';
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const hours = (seconds: number) => (seconds / 3600).toFixed(2);
const model = (wo: WorkOrder) => [wo.unit_brand, wo.unit_model].filter(Boolean).join(' ') || wo.unit_type || '';

function statusText(wo: WorkOrder) {
  if (wo.approval_status === 'REJECT') return 'Rejected';
  return wo.approval_status === 'WAITING' ? `${STATUS[wo.status]} · Waiting approval` : STATUS[wo.status];
}

export interface WoListPrintInfo {
  /** Site filter of the list; empty for all sites. */
  site: string;
  /** Created date filter (YYYY-MM-DD); empty when not set. */
  start: string;
  end: string;
  preparedBy: string;
}

export function WoListPrint({ rows, info }: { rows: WorkOrder[]; info: WoListPrintInfo }) {
  const byUnit = new Map<number, WorkOrder[]>();
  for (const wo of rows) byUnit.set(wo.unit_id, [...(byUnit.get(wo.unit_id) ?? []), wo]);
  const units = [...byUnit.values()]
    .map((list) => list.sort((a, b) => a.created_at.localeCompare(b.created_at)))
    .sort((a, b) => a[0].unit_number.localeCompare(b[0].unit_number, undefined, { numeric: true }));
  const sites = [...new Set(rows.map((wo) => wo.site).filter(Boolean))];
  const site = info.site || (sites.length === 1 ? sites[0] : sites.length ? 'All sites' : '');
  const created = rows.map((wo) => wo.created_at).sort();
  const from = info.start ? day(info.start) : created.length ? day(created[0]) : '';
  const to = info.end ? day(info.end) : created.length ? day(created.at(-1)!) : '';
  const period = from === to ? from : `${from} – ${to}`;

  return (
    <div className="wolist hidden print:block">
      <h1>WORK ORDER LIST</h1>
      <p className="wolist-sub">Grouped by Unit Number • Daily breakdown and repair tracking • One row per work order</p>
      <table className="wolist-info">
        <tbody>
          <tr>
            <td><b>Site / Pit:</b><span>{site}</span></td>
            <td><b>Reporting Period:</b><span>{period}</span></td>
            <td><b>Prepared By:</b><span>{info.preparedBy}</span></td>
            <td><b>Date:</b><span>{day(new Date().toISOString())}</span></td>
          </tr>
        </tbody>
      </table>

      <h2>UNIT SUMMARY</h2>
      <table className="wolist-summary">
        <thead>
          <tr>
            <th style={{ width: '13%' }}>Unit Number</th>
            <th style={{ width: '15%' }}>DT Model</th>
            <th style={{ width: '7%' }}>Total WO</th>
            <th style={{ width: '7%' }}>Open</th>
            <th style={{ width: '9%' }}>In Progress</th>
            <th style={{ width: '9%' }}>Completed</th>
            <th style={{ width: '12%' }}>Total Downtime (hrs)</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {units.map((list) => {
            const count = (...s: WoStatus[]) => list.filter((wo) => s.includes(wo.status)).length;
            const waiting = list.filter((wo) => wo.approval_status === 'WAITING').length;
            const rejected = list.filter((wo) => wo.approval_status === 'REJECT').length;
            return (
              <tr key={list[0].unit_id}>
                <td>{list[0].unit_number}</td>
                <td>{model(list[0])}</td>
                <td className="num">{list.length}</td>
                <td className="num">{count('OPEN')}</td>
                <td className="num">{count('ON_PROGRESS', 'WAITING')}</td>
                <td className="num">{count('FINISH')}</td>
                <td className="num">{hours(list.reduce((sum, wo) => sum + (wo.total_time || 0), 0))}</td>
                <td>{[waiting && `${waiting} waiting approval`, rejected && `${rejected} rejected`].filter(Boolean).join(' · ')}</td>
              </tr>
            );
          })}
          {!units.length && <tr><td colSpan={8}>No work orders for the selected filters.</td></tr>}
        </tbody>
      </table>

      {units.length > 0 && <h2>WORK ORDER DETAILS — ONE SECTION PER UNIT</h2>}
      {units.map((list) => (
        <section key={list[0].unit_id} className="wolist-unit">
          <p className="wolist-unit-head">
            UNIT NUMBER: <span>{list[0].unit_number}</span> DT MODEL: <span>{model(list[0])}</span> SITE / PIT: <span>{[...new Set(list.map((wo) => wo.site).filter(Boolean))].join(', ')}</span>
          </p>
          <table className="wolist-detail">
            <thead>
              <tr>
                <th style={{ width: '12%' }}>WO No.</th>
                <th style={{ width: '7.5%' }}>Date Reported</th>
                <th style={{ width: '7.5%' }}>Category</th>
                <th style={{ width: '14%' }}>Breakdown Reason / Symptom</th>
                <th style={{ width: '6%' }}>Type</th>
                <th style={{ width: '7.5%' }}>Status</th>
                <th style={{ width: '8%' }}>Assigned Mechanic</th>
                <th style={{ width: '7.5%' }}>Repair Start</th>
                <th style={{ width: '7.5%' }}>Repair End</th>
                <th style={{ width: '5.5%' }}>Downtime (hrs)</th>
                <th>Parts / Repair Action / Remarks</th>
              </tr>
            </thead>
            <tbody>
              {list.map((wo) => (
                <tr key={wo.wo_uuid}>
                  <td>{wo.wo_number}</td>
                  <td>{dt(wo.created_at)}</td>
                  <td>{wo.category ?? ''}</td>
                  <td>{wo.problem}</td>
                  <td>{wo.maintenance_type ? MAINTENANCE[wo.maintenance_type] ?? wo.maintenance_type : ''}</td>
                  <td>{statusText(wo)}</td>
                  <td>{wo.mechanic_name ?? ''}</td>
                  <td>{dt(wo.started_at)}</td>
                  <td>{wo.status === 'FINISH' ? dt(wo.finished_at) : ''}</td>
                  <td className="num">{wo.total_time ? hours(wo.total_time) : ''}</td>
                  <td>
                    {wo.job_code_list && <div><b>Job:</b> {wo.job_code_list}</div>}
                    {wo.part_list && <div><b>Parts:</b> {wo.part_list}</div>}
                    {wo.maintenance_other && <div><b>Notes:</b> {wo.maintenance_other}</div>}
                    {wo.approval_status === 'REJECT' && wo.reject_reason && <div><b>Rejected:</b> {wo.reject_reason}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <p className="wolist-foot">
        Status guide: Open (no step started) • On Progress (a step is running) • Waiting (between steps) • Finish (all steps done) •
        Waiting approval / Rejected (approval of the work order).
        <br />
        Downtime: time from the start of the work order until it finished (until the print time while it is still open).
      </p>
    </div>
  );
}
