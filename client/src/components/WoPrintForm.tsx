import type { ReactNode } from 'react';
import { durationBetween, formatDateTime } from '../lib/format';
import type { WorkOrderDetail } from '../lib/types';
import { formatMeter } from './MeterFields';

/**
 * Printed "Work Order Request Form" (A4, two pages), laid out like the paper template
 * Work_order_Request_Form_template.pdf and filled with the work order's data. Hidden on screen; shown by the browser
 * print of the work order detail page. Fields the system does not know (signatures, form number, payment, ...) stay
 * blank lines or empty boxes to fill in by hand. Always English, like the template.
 */

const JOB_ROWS = 5;
const PART_ROWS = 8;
const NOTE_ROWS = 2;

const box = (ticked: boolean) => (ticked ? '☑' : '☐');
const dt = (iso: string | null | undefined) => (iso ? formatDateTime(iso) : '');
const hours = (seconds: number | null) => (seconds ? (seconds / 3600).toFixed(2) : '');
const qty = (n: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(n);
const line = (w = '9rem') => <span className="woform-line" style={{ width: w }} />;

function Section({ children }: { children: ReactNode }) {
  return <div className="woform-section">{children}</div>;
}

export function WoPrintForm({ wo }: { wo: WorkOrderDetail }) {
  const steps = [...wo.steps, ...wo.additional_work];
  const first = steps.find((s) => s.step_no === 1 && !s.is_additional);
  const rfu = wo.steps.at(-1);
  const opened = steps.map((s) => s.started_at).filter(Boolean).sort()[0] ?? null;
  // Closed when the last step was finished (the WO row itself may be touched later, e.g. by a proof upload).
  const closed = wo.status === 'FINISH' ? steps.map((s) => s.finished_at).filter(Boolean).sort().at(-1) ?? wo.finished_at : null;
  const type = wo.maintenance_type;
  const jobs = wo.job_codes;
  const parts = wo.job_codes.flatMap((j) => (j.parts ?? []).map((p) => ({ ...p, job_code: j.job_code })));
  // Step remarks; the approval remark is printed under Additional Instructions > Remark.
  const notes = steps.filter((s) => s.remarks).map((s) => `Step ${s.step_no} · ${s.step_name}: ${s.remarks}`);
  const unitType = [wo.unit_type, [wo.unit_brand, wo.unit_model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  const meters = [wo.hm != null ? `${formatMeter(wo.hm, 'en')} HM` : '', wo.km != null ? `${formatMeter(wo.km, 'en')} KM` : ''].filter(Boolean).join(' / ');

  return (
    <div className="woform hidden print:block">
      {/* ---------- Page 1 ---------- */}
      <table className="woform-head">
        <tbody>
          <tr>
            <td className="woform-brand">
              <strong>MOTOR SIGHTS</strong>
              <small>Service &amp; Support</small>
            </td>
            <td className="woform-title">WORK ORDER REQUEST FORM</td>
            <td className="woform-meta">
              <b>Form No.:</b> {line('4rem')}
              <br />
              <b>Revision:</b> {line('3rem')}
              <br />
              <b>Page:</b> 1 of 2
            </td>
          </tr>
        </tbody>
      </table>

      <table className="woform-grid">
        <tbody>
          <tr>
            <th className="w-[18%]">TYPE OF MAINTENANCE <span className="font-normal">(tick as applicable)</span></th>
            <td>{box(type === 'PREVENTIVE')} Preventive Maintenance</td>
            <td>{box(type === 'REPAIR')} Repair</td>
            <td>{box(type === 'WARRANTY')} Warranty</td>
            <td>{box(type === 'PDI')} PDI</td>
            <td>{box(type === 'OTHERS')} Others</td>
          </tr>
          <tr>
            <th>NOTES</th>
            <td colSpan={5} className="whitespace-pre-wrap break-words">{wo.maintenance_other ?? ''}</td>
          </tr>
        </tbody>
      </table>

      <table className="woform-grid woform-info">
        <tbody>
          <tr>
            <th>Work Order No.</th>
            <td>{wo.wo_number}</td>
            <th>Unit Type</th>
            <td>{unitType}</td>
            <th>BD Date/Time</th>
            <td>{dt(first?.started_at ?? wo.created_at)}</td>
          </tr>
          <tr>
            <th>HM/KM</th>
            <td>{meters}</td>
            <th>Unit Number</th>
            <td>{wo.unit_number} ({wo.unit_code})</td>
            <th>Location / Site</th>
            <td>{wo.site ?? ''}</td>
          </tr>
          <tr>
            <th>VIN Number</th>
            <td>{wo.unit_serial ?? ''}</td>
            <th>Customer / Company</th>
            <td>{wo.site_company ?? ''}</td>
            <th>Request Date</th>
            <td>{dt(wo.created_at)}</td>
          </tr>
        </tbody>
      </table>

      <Section>OPERATOR COMPLAINT / OPEN WORK ORDER REQUEST (to be completed based on customer request)</Section>
      <table className="woform-grid">
        <tbody>
          <tr>
            <td className="w-[22%] align-top">Complaint / Problem Description:</td>
            <td className="woform-tall align-top whitespace-pre-wrap">{wo.problem}</td>
          </tr>
        </tbody>
      </table>
      <table className="woform-grid woform-sign">
        <tbody>
          <tr>
            <td>Reported by: Mechanic / Requester</td>
            <td>Acknowledged by: Coordinator</td>
          </tr>
          <tr>
            <td className="woform-signspace">
              Name: <span className="woform-filled">{wo.created_by_name ?? ''}</span>
              <br />
              Signature: {line()}
            </td>
            <td className="woform-signspace">
              Name: {line()}
              <br />
              Signature: {line()}
            </td>
          </tr>
        </tbody>
      </table>

      <Section>ADDITIONAL INSTRUCTIONS (to be completed by Service Division)</Section>
      <table className="woform-grid woform-indent woform-info">
        <tbody>
          <tr>
            <th>Customer Type</th>
            <td>{box(false)} Internal</td>
            <td>{box(false)} External</td>
            <th>Remark</th>
            <td>{wo.approval_remarks ?? ''}</td>
          </tr>
          <tr>
            <th>Customer Name</th>
            <td colSpan={2}>{wo.site_company ?? ''}</td>
            <th>Work Order Open Date/Time</th>
            <td>{dt(opened)}</td>
          </tr>
          <tr>
            <th>Work Order Closing Date/Time</th>
            <td colSpan={2}>{dt(closed)}</td>
            <th>Time Out</th>
            <td>{dt(rfu?.finished_at)}</td>
          </tr>
          <tr>
            <th>Payment</th>
            <td>{box(false)} Customer Paid</td>
            <td>{box(false)} Free</td>
            <td colSpan={2}>{box(false)} Others: {line('3.5rem')}</td>
          </tr>
        </tbody>
      </table>

      <Section>DESCRIPTION OF WORK COMPLETED (to be completed by Service Division)</Section>
      <table className="woform-grid woform-indent woform-rows">
        <thead>
          <tr>
            <th className="w-[6%]">No.</th>
            <th className="w-[20%]">Mechanic / Crew</th>
            <th>Action / Work Performed</th>
            <th className="w-[18%]">Job Code</th>
            <th className="w-[12%]">Time (hrs)</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.max(JOB_ROWS, jobs.length) }, (_, i) => {
            const j = jobs[i];
            return (
              <tr key={i}>
                <td className="woform-no">{i + 1}</td>
                <td>{j?.mechanic_name ?? ''}</td>
                <td>{j?.job_name ?? ''}</td>
                <td>{j?.job_code ?? ''}</td>
                <td>{j ? hours(durationBetween(j.started_at, j.finished_at)) : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Section>PARTS &amp; OIL NEEDED (to be completed by Service Division)</Section>
      <table className="woform-grid woform-indent woform-rows">
        <thead>
          <tr>
            <th className="w-[6%]">No.</th>
            <th>Description</th>
            <th className="w-[28%]">Part Number / Interchange</th>
            <th className="w-[10%]">Qty</th>
            <th className="w-[16%]">Remark</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.max(PART_ROWS, parts.length) }, (_, i) => {
            const p = parts[i];
            return (
              <tr key={i}>
                <td className="woform-no">{i + 1}</td>
                <td>{p?.part_name ?? ''}</td>
                <td>{p?.part_number ?? ''}</td>
                <td>{p ? `${qty(p.qty)} ${p.uom}` : ''}</td>
                <td>{p?.job_code ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ---------- Page 2 ---------- */}
      <div className="woform-page2">
        <Section>NOTES / FINDINGS (to be completed by Service Division)</Section>
        <table className="woform-grid woform-rows">
          <tbody>
            {Array.from({ length: Math.max(NOTE_ROWS, notes.length) }, (_, i) => (
              <tr key={i}>
                <td>{notes[i] ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <Section>WORK ORDER CLOSING</Section>
        <table className="woform-grid woform-sign">
          <tbody>
            <tr>
              <td className="woform-closing">
                Performed by
                <br />
                <br />
                Name: <span className="woform-filled">{wo.mechanic_name ?? ''}</span>
                <br />
                Signature: {line('7rem')}
              </td>
              <td className="woform-closing">
                Acknowledged by
                <br />
                <br />
                Coordinator After Sales
                <br />
                Name: {line('7rem')}
                <br />
                Signature: {line('7rem')}
              </td>
              <td className="woform-closing">
                Approved / Confirmed by Customer
                <br />
                <br />
                Name: {line('7rem')}
                <br />
                Signature: {line('7rem')}
              </td>
            </tr>
          </tbody>
        </table>

        <table className="woform-grid woform-warranty">
          <tbody>
            <tr className="woform-warranty-head">
              <th className="w-[24%]">WARRANTY</th>
              <td>For work orders related to warranty claims, follow the MSI Warranty Procedure. Parts and service charges that are not approved by the principal may be charged to the customer.</td>
            </tr>
            <tr>
              <td className="woform-closing">
                <b>Customer Representative</b>
                <br />
                <br />
                <span className="whitespace-nowrap">Name / Signature: {line('3rem')}</span>
              </td>
              <td className="woform-closing">
                <b>Warranty Officer</b>
                <br />
                <br />
                Name / Signature: {line('7rem')}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="woform-foot">Printed from WOS · {wo.wo_number} · {formatDateTime(new Date().toISOString())}</p>
      </div>
    </div>
  );
}
