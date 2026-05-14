import { useEffect, useRef, useState } from "react";
import type { ElderProfile } from "@mem/memory-schema";
import { getElderProfile, upsertElderProfile } from "../lib/api.js";
import { copy } from "../lib/copy.js";

type Props = {
  elderId: string;
  onClose: () => void;
};

type FormState = {
  displayName: string;
  wakeTime: string;
  sleepTime: string;
  medicationsText: string;
  placesText: string;
  notes: string;
};

function profileToForm(profile: ElderProfile): FormState {
  const medicationsText = profile.medications
    .map((m) => [m.name, m.dosage, m.frequency].filter(Boolean).join(" "))
    .join("\n");
  const placesText = profile.places.map((p) => p.name).join("\n");
  return {
    displayName: profile.displayName ?? "",
    wakeTime: profile.wakeTime ?? "",
    sleepTime: profile.sleepTime ?? "",
    medicationsText,
    placesText,
    notes: profile.notes ?? "",
  };
}

function parseMedications(text: string): Array<{ name: string; dosage?: string }> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(" ");
      if (idx === -1) return { name: line };
      return { name: line.slice(0, idx), dosage: line.slice(idx + 1).trim() };
    });
}

function parsePlaces(text: string): Array<{ name: string }> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
}

export function SettingsPanel({ elderId, onClose }: Props) {
  const [form, setForm] = useState<FormState>({
    displayName: "", wakeTime: "", sleepTime: "", medicationsText: "", placesText: "", notes: "",
  });
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getElderProfile(elderId).then((profile) => {
      if (!cancelled) setForm(profileToForm(profile));
    }).catch(() => {
      // If load fails, start with empty form
    });
    return () => { cancelled = true; };
  }, [elderId]);

  useEffect(() => {
    return () => { if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current); };
  }, []);

  function handleChange(field: keyof FormState, value: string) {
    setForm((cur) => ({ ...cur, [field]: value }));
    setSaved(false);
    setError(null);
  }

  async function handleSave() {
    setLoading(true);
    setError(null);
    try {
      await upsertElderProfile({
        elderId,
        displayName: form.displayName.trim() || undefined,
        wakeTime: form.wakeTime || undefined,
        sleepTime: form.sleepTime || undefined,
        medications: parseMedications(form.medicationsText),
        places: parsePlaces(form.placesText),
        notes: form.notes.trim() || undefined,
      });
      setSaved(true);
      closeTimerRef.current = window.setTimeout(() => {
        onClose();
      }, 3_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-b border-slate-100 bg-slate-50 px-6 py-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-900">{copy.settings.title}</h2>
        <button
          aria-label={copy.settings.close}
          className="rounded-full px-3 py-1 text-sm text-slate-500 hover:bg-slate-200"
          type="button"
          onClick={onClose}
        >
          {copy.settings.close}
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="elder-profile-display-name">{copy.settings.fieldDisplayName}</label>
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-slate-400"
            disabled={loading}
            id="elder-profile-display-name"
            placeholder={copy.settings.fieldDisplayNamePlaceholder}
            type="text"
            value={form.displayName}
            onChange={(e) => handleChange("displayName", e.target.value)}
          />
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="elder-profile-wake-time">{copy.settings.fieldWakeTime}</label>
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-slate-400"
              disabled={loading}
              id="elder-profile-wake-time"
              type="time"
              value={form.wakeTime}
              onChange={(e) => handleChange("wakeTime", e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="elder-profile-sleep-time">{copy.settings.fieldSleepTime}</label>
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-slate-400"
              disabled={loading}
              id="elder-profile-sleep-time"
              type="time"
              value={form.sleepTime}
              onChange={(e) => handleChange("sleepTime", e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="elder-profile-medications">{copy.settings.fieldMedications}</label>
          <textarea
            className="mt-1 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-base leading-6 text-slate-900 outline-none focus:border-slate-400"
            disabled={loading}
            id="elder-profile-medications"
            placeholder={copy.settings.fieldMedicationsPlaceholder}
            rows={3}
            value={form.medicationsText}
            onChange={(e) => handleChange("medicationsText", e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="elder-profile-places">{copy.settings.fieldPlaces}</label>
          <textarea
            className="mt-1 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-base leading-6 text-slate-900 outline-none focus:border-slate-400"
            disabled={loading}
            id="elder-profile-places"
            placeholder={copy.settings.fieldPlacesPlaceholder}
            rows={2}
            value={form.placesText}
            onChange={(e) => handleChange("placesText", e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="elder-profile-notes">{copy.settings.fieldNotes}</label>
          <textarea
            className="mt-1 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-base leading-6 text-slate-900 outline-none focus:border-slate-400"
            disabled={loading}
            id="elder-profile-notes"
            placeholder={copy.settings.fieldNotesPlaceholder}
            rows={2}
            value={form.notes}
            onChange={(e) => handleChange("notes", e.target.value)}
          />
        </div>

        {error ? <p className="text-sm text-red-500">{error}</p> : null}

        <div className="flex items-center gap-3">
          <button
            className={`flex-1 rounded-full py-3 text-base font-semibold text-white shadow-sm transition-colors ${loading ? "bg-slate-400" : "bg-slate-950 hover:bg-slate-800"}`}
            disabled={loading}
            type="button"
            onClick={() => void handleSave()}
          >
            {saved ? copy.settings.saveSuccess : copy.settings.save}
          </button>
        </div>
      </div>
    </div>
  );
}
