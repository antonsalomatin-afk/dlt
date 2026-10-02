'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { examQuestionReportRequestSchema, examQuestionReportResponseSchema, type Session } from '../lib/contracts';

type ReportStatus = 'submitted' | 'duplicate';
type ReportEntry = { open: boolean; details: string; error: string | null; status: ReportStatus | null };
type ControllerOptions = {
  session: Session;
  isActive: () => boolean;
  isBlocked?: () => boolean;
  onExpired: () => void;
};

const emptyEntry = (): ReportEntry => ({ open: false, details: '', error: null, status: null });

export function useExamReportController(options: ControllerOptions) {
  const [entries, setEntries] = useState<Record<string, ReportEntry>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const entriesRef = useRef(entries);
  const busy = useRef(false);
  const generation = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const replaceEntries = useCallback((next: Record<string, ReportEntry>) => {
    entriesRef.current = next;
    setEntries(next);
  }, []);

  const updateEntry = useCallback((examQuestionId: string, update: (entry: ReportEntry) => ReportEntry) => {
    const next = { ...entriesRef.current, [examQuestionId]: update(entriesRef.current[examQuestionId] ?? emptyEntry()) };
    replaceEntries(next);
  }, [replaceEntries]);

  const invalidateAll = useCallback(() => {
    generation.current++;
    busy.current = false;
    setPendingId(null);
    replaceEntries({});
  }, [replaceEntries]);

  useEffect(() => () => {
    generation.current++;
    busy.current = false;
  }, []);

  const open = useCallback((examQuestionId: string) => {
    if (busy.current || optionsRef.current.isBlocked?.()) return;
    updateEntry(examQuestionId, (entry) => entry.status ? entry : { ...entry, open: true, error: null });
  }, [updateEntry]);

  const setDetails = useCallback((examQuestionId: string, details: string) => {
    if (busy.current || optionsRef.current.isBlocked?.()) return;
    updateEntry(examQuestionId, (entry) => ({ ...entry, details, error: null }));
  }, [updateEntry]);

  const cancel = useCallback((examQuestionId: string) => {
    if (busy.current) return;
    updateEntry(examQuestionId, (entry) => entry.status ? entry : emptyEntry());
  }, [updateEntry]);

  const clearDraft = useCallback((examQuestionId: string) => {
    if (busy.current) return;
    const entry = entriesRef.current[examQuestionId];
    if (!entry || entry.status) return;
    const next = { ...entriesRef.current };
    delete next[examQuestionId];
    replaceEntries(next);
  }, [replaceEntries]);

  const submit = useCallback(async (examQuestionId: string) => {
    if (busy.current || optionsRef.current.isBlocked?.() || !optionsRef.current.isActive()) return;
    const entry = entriesRef.current[examQuestionId] ?? emptyEntry();
    if (entry.status) return;
    const input = examQuestionReportRequestSchema.safeParse({ examQuestionId, details: entry.details });
    if (!input.success) {
      updateEntry(examQuestionId, (current) => ({ ...current, error: 'Enter 3–1000 characters with no surrounding spaces or unsupported control characters.' }));
      return;
    }
    const requestGeneration = ++generation.current;
    busy.current = true;
    setPendingId(examQuestionId);
    updateEntry(examQuestionId, (current) => ({ ...current, error: null }));
    try {
      const response = await fetch('/exam/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${optionsRef.current.session.token}` },
        body: JSON.stringify(input.data),
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      if (!optionsRef.current.isActive() || requestGeneration !== generation.current) return;
      if (response.status === 401) {
        generation.current++;
        busy.current = false;
        optionsRef.current.onExpired();
        return;
      }
      if (response.status === 404) {
        updateEntry(examQuestionId, (current) => ({ ...current, error: 'This exam question is no longer available to report. Your details are still here.' }));
        return;
      }
      if (response.status === 409) {
        updateEntry(examQuestionId, () => ({ open: false, details: '', error: null, status: 'duplicate' }));
        return;
      }
      if (!response.ok) throw new Error('Exam report request failed');
      const payload: unknown = await response.json();
      if (!optionsRef.current.isActive() || requestGeneration !== generation.current) return;
      const result = examQuestionReportResponseSchema.parse(payload);
      if (result.examQuestionId !== examQuestionId) throw new Error('Exam report identity mismatch');
      updateEntry(examQuestionId, () => ({ open: false, details: '', error: null, status: 'submitted' }));
    } catch {
      if (optionsRef.current.isActive() && requestGeneration === generation.current) {
        updateEntry(examQuestionId, (current) => ({ ...current, error: 'We could not submit this report. Your details are still here. Please retry.' }));
      }
    } finally {
      if (requestGeneration === generation.current) {
        busy.current = false;
        if (optionsRef.current.isActive()) setPendingId(null);
      }
    }
  }, [updateEntry]);

  return {
    entries,
    pending: pendingId !== null,
    pendingId,
    isBusy: () => busy.current,
    open,
    setDetails,
    cancel,
    clearDraft,
    invalidateAll,
    submit,
  };
}

export type ExamReportController = ReturnType<typeof useExamReportController>;

export function ExamReportForm({ controller, examQuestionId, disabled = false }: {
  controller: ExamReportController;
  examQuestionId: string;
  disabled?: boolean;
}) {
  const entry = controller.entries[examQuestionId] ?? emptyEntry();
  const mutationDisabled = disabled || controller.pending;
  const suffix = examQuestionId.replaceAll('-', '');
  if (entry.status) return <p className="report-state" role="status">{entry.status === 'duplicate' ? 'Report already submitted' : 'Report submitted'}</p>;
  if (!entry.open) return <button className="secondary report-action" disabled={mutationDisabled} onClick={() => controller.open(examQuestionId)}>Report question</button>;
  return <form className="report-form" onSubmit={(event) => { event.preventDefault(); void controller.submit(examQuestionId); }}>
    <label htmlFor={`exam-report-details-${suffix}`}>What may be wrong with this question?</label>
    <p id={`exam-report-guidance-${suffix}`}>Describe the suspected issue only. A report is an allegation for human review and does not confirm an error.</p>
    <textarea
      id={`exam-report-details-${suffix}`}
      name={`exam-report-details-${suffix}`}
      rows={5}
      value={entry.details}
      disabled={mutationDisabled}
      aria-describedby={`exam-report-guidance-${suffix}${entry.error ? ` exam-report-error-${suffix}` : ''}`}
      onChange={(event) => controller.setDetails(examQuestionId, event.target.value)}
    />
    {entry.error && <p id={`exam-report-error-${suffix}`} className="inline-error" role="alert">{entry.error}</p>}
    <div className="report-controls">
      <button className="secondary" type="button" disabled={mutationDisabled} onClick={() => controller.cancel(examQuestionId)}>Cancel</button>
      <button className="primary" type="submit" disabled={mutationDisabled}>{controller.pendingId === examQuestionId ? 'Submitting report…' : 'Submit report'}</button>
    </div>
  </form>;
}
