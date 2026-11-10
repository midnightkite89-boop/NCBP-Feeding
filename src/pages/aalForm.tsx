import { useEffect } from 'react';

// The look shared by every printed AAL form, copied from SMJ's Word originals:
// logo, bold Arial title, date/owner/retention line, Guidance, and the address
// footer on every page. Landscape forms sit the logo beside the title, as theirs do.

export const dmy = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

export function FormSheet({ title, subtitle, landscape, serif, meta, guidance, children }: { title: string; subtitle?: string; landscape?: boolean; serif?: boolean; meta?: React.ReactNode[]; guidance?: readonly string[]; children: React.ReactNode }) {
  useEffect(() => {
    if (!landscape) return;
    const style = document.createElement('style');
    style.textContent = '@page { size: A4 landscape; margin: 10mm 12mm; }';
    document.head.appendChild(style);
    return () => style.remove();
  }, [landscape]);

  // The outer table is what makes browsers repeat the footer on each printed page
  return (
    <table className={`form-sheet${landscape ? ' form-wide' : ''}${serif ? ' form-serif' : ''}`}>
      <tbody>
        <tr>
          <td>
            <header className="form-head">
              <img src="/smj-form-logo.png" alt="SMJ Falconry" />
              <h1>{title}</h1>
              {subtitle && <p className="form-subtitle">{subtitle}</p>}
            </header>
            {meta && (
              <div className="form-meta">
                {meta.map((m, i) => (
                  <span key={i}>{m}</span>
                ))}
              </div>
            )}
            {guidance && (
              <section className="form-print-only">
                <h2 className="aal-h">Guidance</h2>
                <ul className="form-guidance">
                  {guidance.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </section>
            )}
            {children}
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td>
            <footer className="form-foot">
              <div>SMJ Falconry &amp; Crafts, Ox Hays, Long Ridging Farm, Hawksbridge Lane, Oxenhope. BD22 9QY</div>
              <div className="form-foot-row">
                <span>T: 01535 646800</span>
                <span>VAT No. 198 8209 51</span>
              </div>
            </footer>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

/** A label and its dotted line, as the paper forms have */
export function Dot({ label, children, wide }: { label: string; children?: React.ReactNode; wide?: boolean }) {
  return (
    <span className={`form-dot${wide ? ' form-dot-wide' : ''}`}>
      <span className="form-dot-l">{label}</span>
      <span className="form-dot-v">{children}</span>
    </span>
  );
}

export function DotLine({ children }: { children: React.ReactNode }) {
  return <div className="form-line">{children}</div>;
}

/** Empty rows so a short list still has the form's blank lines to write on */
export function BlankRows({ have, upTo, cols, numbered }: { have: number; upTo: number; cols: number; numbered?: boolean }) {
  return (
    <>
      {Array.from({ length: Math.max(0, upTo - have) }, (_, i) => (
        <tr key={i} className="form-blank">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className={numbered && c === 0 ? 'aal-n' : undefined}>
              {numbered && c === 0 ? have + i + 1 : ''}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
