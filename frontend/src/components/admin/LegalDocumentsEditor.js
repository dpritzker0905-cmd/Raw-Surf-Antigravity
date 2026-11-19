/**
 * LegalDocumentsEditor - Compliance > Legal documents, with one sub-section per document:
 * Terms of Service, Privacy Policy, and Forecast data consent (the opt-in for using a person's wave reports to improve
 * forecasts; services/surf_truth_consent.py on the backend).
 *
 * All three are versioned `tos_content` documents (GET /compliance/tos-content/current, PUT /compliance/tos-content).
 * Version rule for the consent, shown to the admin: a version names ONE text, because people agreed to that text. Any
 * change of words needs a NEW version (the server refuses it otherwise, 409), and a new version asks everyone who
 * opted in again. Re-publishing the same text under the same version changes nothing for anyone.
 *
 * Themes: semantic tokens only (card/background/border/foreground/muted/primary), which light, dark and beach all
 * define; inputs in beach mode pair the global amber-900 input text with a light amber field (as BlindHeightInput).
 * Accessibility: a real disclosure button, a keyboard tablist (arrows, Home, End), labelled fields, state in words.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, Loader2, Plus, Save, ScrollText, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';
import { useThemeName } from '../../contexts/ThemeContext';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';

export const LEGAL_DOCS = [
  { id: 'tos', label: 'Terms of Service', short: 'ToS',
    help: 'Shown at sign-up and in Settings > Legal. To make everyone accept again, also update the version in constants/tos.js.' },
  { id: 'privacy', label: 'Privacy Policy', short: 'Privacy Policy',
    help: 'Shown in Settings > Legal.' },
  { id: 'forecast_consent', label: 'Forecast data consent', short: 'consent',
    help: 'The opt-in under the "How big is it?" report form and in Settings > Legal: whether a person\'s wave reports may be used to check and improve the surf forecast. Off unless they turn it on.' },
];

const isConsent = (id) => id === 'forecast_consent';

function download(name, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function parseImport(file, onSections) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const text = e.target.result;
      if (file.name.endsWith('.json')) {
        const data = JSON.parse(text);
        if (!Array.isArray(data.sections)) throw new Error('JSON must contain a "sections" array');
        onSections(data.sections, data.version, data.effective_date);
      } else if (file.name.endsWith('.csv')) {
        const rows = text.split('\n').filter((l) => l.trim()).slice(1);
        const clean = (s) => (s || '').replace(/^"|"$/g, '').replace(/""/g, '"').trim();
        const sections = rows.map((line) => line.match(/(?:"([^"]*(?:""[^"]*)*)"|([^,]*))/g) || [])
          .filter((m) => m.length >= 2)
          .map((m) => (m.length >= 3 ? { title: clean(m[1]), body: clean(m[2]) } : { title: clean(m[0]), body: clean(m[1]) }))
          .filter((s) => s.title);
        if (!sections.length) throw new Error('No valid sections found in the CSV');
        onSections(sections);
      } else {
        throw new Error('Use a .json or .csv file');
      }
    } catch (err) {
      toast.error(`Import failed: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

function ConsentSummary() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    apiClient.get('/compliance/forecast-consent/summary')
      .then((res) => { if (live) setData(res.data); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  if (!data) return null;
  return (
    <dl className="grid grid-cols-3 gap-2" aria-label="Forecast data consent counts">
      {[['Opted in (this version)', data.opted_in], ['Asked again (older version)', data.awaiting_reconsent],
        ['Opted out', data.opted_out]].map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border bg-muted/40 p-2">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-lg font-semibold text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function LegalDocumentsEditor() {
  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState('tos');
  const [version, setVersion] = useState('');
  const [loadedVersion, setLoadedVersion] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [sections, setSections] = useState([]);
  const [loadedSections, setLoadedSections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const tabRefs = useRef({});
  const theme = useThemeName();
  const field = `w-full rounded-md border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground
    focus:outline-none focus:ring-2 focus:ring-ring ${theme === 'beach' ? 'bg-amber-50' : 'bg-background'}`;

  const load = useCallback(async (dt) => {
    setLoading(true);
    try {
      const res = await apiClient.get(`/compliance/tos-content/current?doc_type=${dt}`);
      setVersion(res.data.version || '1.0');
      setLoadedVersion(res.data.version || '1.0');
      setEffectiveDate(res.data.effective_date || '');
      setSections(res.data.sections || []);
      setLoadedSections(res.data.sections || []);
    } catch {
      toast.error('Could not load the document');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) load(docType); }, [open, docType, load]);

  const doc = LEGAL_DOCS.find((d) => d.id === docType);
  const consent = isConsent(docType);
  const newVersion = version.trim() !== '' && version.trim() !== loadedVersion;
  const words = (secs) => JSON.stringify((secs || []).slice(0, 1).map((s) => [(s.title || '').trim(), (s.body || '').trim()]));
  // The consent's text under a published version is what people agreed to: changing it needs a new version.
  const textLocked = consent && !newVersion && words(sections) !== words(loadedSections);

  const choose = (id) => {
    setDocType(id);
    tabRefs.current[id]?.focus();
  };
  const onTabKey = (e) => {
    const ids = LEGAL_DOCS.map((d) => d.id);
    const i = ids.indexOf(docType);
    const next = { ArrowRight: ids[(i + 1) % ids.length], ArrowLeft: ids[(i - 1 + ids.length) % ids.length],
      Home: ids[0], End: ids[ids.length - 1] }[e.key];
    if (next) {
      e.preventDefault();
      choose(next);
    }
  };

  const update = (idx, key, value) => setSections((prev) => prev.map((s, i) => (i === idx ? { ...s, [key]: value } : s)));

  const publish = async () => {
    if (!version.trim()) return toast.error('Enter a version');
    if (!sections.length) return toast.error('Add at least one section');
    if (consent && (!sections[0]?.title?.trim() || !sections[0]?.body?.trim())) {
      return toast.error('The consent needs both a checkbox label and its text');
    }
    setSaving(true);
    try {
      await apiClient.put('/compliance/tos-content', { doc_type: docType, version: version.trim(),
        sections: consent ? sections.slice(0, 1) : sections, effective_date: effectiveDate, set_active: true });
      toast.success(`${doc.label} ${version.trim()} published`);
      setLoadedVersion(version.trim());
      setLoadedSections(consent ? sections.slice(0, 1) : sections);
    } catch (err) {
      toast.error(err?.response?.data?.detail?.toString?.() || 'Could not publish');
    } finally {
      setSaving(false);
    }
  };

  const exportJson = () => download(`${docType}_v${version}.json`, 'application/json', JSON.stringify(
    { doc_type: docType, version, effective_date: effectiveDate, sections, exported_at: new Date().toISOString() }, null, 2));
  const exportCsv = () => {
    const esc = (s) => `"${(s || '').replace(/"/g, '""')}"`;
    download(`${docType}_v${version}.csv`, 'text/csv',
      ['Section Number,Title,Body', ...sections.map((s, i) => `${i + 1},${esc(s.title)},${esc(s.body)}`)].join('\n'));
  };

  return (
    <Card className="bg-card border-border mt-6" data-testid="legal-documents-editor">
      <CardHeader>
        <button type="button" aria-expanded={open} aria-controls="legal-documents-body" onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between rounded-md text-left focus:outline-none focus:ring-2 focus:ring-ring">
          <CardTitle className="flex items-center gap-2 text-foreground">
            <ScrollText className="h-5 w-5 text-primary" aria-hidden="true" />
            Legal documents
          </CardTitle>
          <ChevronDown aria-hidden="true"
            className={`h-5 w-5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </CardHeader>

      <div id="legal-documents-body" hidden={!open}>
        {open && (
          <CardContent className="space-y-4">
            <div role="tablist" aria-label="Legal documents" className="flex flex-wrap gap-2">
              {LEGAL_DOCS.map((d) => {
                const selected = d.id === docType;
                return (
                  <button key={d.id} type="button" role="tab" id={`legal-tab-${d.id}`} aria-selected={selected}
                    aria-controls="legal-panel" tabIndex={selected ? 0 : -1}
                    ref={(el) => { tabRefs.current[d.id] = el; }} onClick={() => choose(d.id)} onKeyDown={onTabKey}
                    className={`min-h-[40px] rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring
                      ${selected ? 'border-primary bg-primary/15 font-semibold text-foreground' : 'border-border bg-card text-foreground hover:bg-muted'}`}>
                    {d.label}
                  </button>
                );
              })}
            </div>

            <section id="legal-panel" role="tabpanel" aria-labelledby={`legal-tab-${docType}`} className="space-y-4">
              <p className="text-sm text-muted-foreground">{doc.help}</p>
              {consent && <ConsentSummary />}

              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="flex-1">
                  <label htmlFor="legal-version" className="mb-1 block text-xs text-muted-foreground">Version</label>
                  <input id="legal-version" aria-label="Version" value={version} maxLength={20} onChange={(e) => setVersion(e.target.value)}
                    className={field} placeholder="for example 1.0" />
                </div>
                <div className="flex-1">
                  <label htmlFor="legal-effective" className="mb-1 block text-xs text-muted-foreground">Effective date</label>
                  <input id="legal-effective" aria-label="Effective date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)}
                    className={field} placeholder="for example May 2026" />
                </div>
              </div>

              {consent && (
                <p role="status" className="rounded-lg border border-border bg-muted/40 p-2 text-sm text-foreground">
                  {newVersion
                    ? `New version: everyone who opted in under ${loadedVersion} is asked again and counts as off until they agree.`
                    : textLocked
                      ? `The text of version ${loadedVersion} cannot change: people agreed to it. Enter a new version to publish these words; everyone who opted in will be asked again.`
                      : `Same version (${loadedVersion}), same text: everyone who opted in stays opted in.`}
                </p>
              )}

              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
                </div>
              ) : consent ? (
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <div>
                    <label htmlFor="consent-label" className="mb-1 block text-xs text-muted-foreground">Checkbox label</label>
                    <input id="consent-label" aria-label="Checkbox label" value={sections[0]?.title || ''} className={field}
                      onChange={(e) => setSections([{ ...(sections[0] || {}), title: e.target.value }])} />
                  </div>
                  <div>
                    <label htmlFor="consent-text" className="mb-1 block text-xs text-muted-foreground">Text under the checkbox</label>
                    <Textarea id="consent-text" aria-label="Text under the checkbox" rows={4} value={sections[0]?.body || ''} className={field}
                      onChange={(e) => setSections([{ ...(sections[0] || {}), body: e.target.value }])} />
                  </div>
                </div>
              ) : (
                <ol className="space-y-3">
                  {sections.map((s, idx) => (
                    <li key={idx} className="rounded-lg border border-border bg-muted/30 p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <label htmlFor={`legal-title-${idx}`} className="sr-only">Section {idx + 1} title</label>
                        <input id={`legal-title-${idx}`} aria-label={`Section ${idx + 1} title`} value={s.title} onChange={(e) => update(idx, 'title', e.target.value)}
                          className={`${field} font-medium`} />
                        <button type="button" aria-label={`Remove section ${idx + 1}`}
                          onClick={() => setSections((prev) => prev.filter((_, i) => i !== idx))}
                          className="rounded p-1 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                      <label htmlFor={`legal-body-${idx}`} className="sr-only">Section {idx + 1} text</label>
                      <Textarea id={`legal-body-${idx}`} aria-label={`Section ${idx + 1} text`} rows={3} value={s.body} className={field}
                        onChange={(e) => update(idx, 'body', e.target.value)} />
                    </li>
                  ))}
                </ol>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {!consent && (
                  <Button variant="outline" size="sm" className="flex items-center gap-1.5"
                    onClick={() => setSections((prev) => [...prev, { title: `${prev.length + 1}. New section`, body: '' }])}>
                    <Plus className="h-4 w-4" aria-hidden="true" /> Add section
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={exportJson} aria-label="Export as JSON">
                  <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> JSON
                </Button>
                <Button variant="outline" size="sm" onClick={exportCsv} aria-label="Export as CSV">
                  <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> CSV
                </Button>
                {!consent && (
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
                    <input type="file" accept=".json,.csv" className="sr-only" aria-label="Import JSON or CSV"
                      onChange={(e) => {
                        const f = e.target.files[0];
                        if (f) parseImport(f, (secs, v, d) => { setSections(secs); if (v) setVersion(v); if (d) setEffectiveDate(d); toast.success(`Imported ${secs.length} sections`); });
                        e.target.value = '';
                      }} />
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Import
                  </label>
                )}
                <Button onClick={publish} disabled={saving || loading || textLocked} className="min-w-[200px] flex-1">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    : <Save className="mr-2 h-4 w-4" aria-hidden="true" />}
                  {saving ? 'Publishing...' : `Publish ${doc.short} ${version.trim() || ''}${consent && newVersion ? ' (asks everyone again)' : ''}`}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Publishing makes this version the one everyone sees, immediately.
              </p>
            </section>
          </CardContent>
        )}
      </div>
    </Card>
  );
}
