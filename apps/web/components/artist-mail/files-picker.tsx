"use client";

/*
 * Gifts and collectibles with an email (owner, 2026-11-02, D-MAIL-02): tick "Include files", then
 * choose soft copies from the act's list, upload a new one (same size limit as other uploads) or add
 * a link to one kept elsewhere. Each recipient gets their own download link; downloads are counted
 * in the report.
 */

import { useRef, useState } from "react";
import { FileUp, Link2, Paperclip, Trash2 } from "lucide-react";

import { Button, Input } from "@/components/ds";
import { addMailFileLink, deleteMailFile, uploadMailFile, type MailFile, type MailProfile } from "@/features/artist-mail/api";
import { ApiError } from "@/lib/api/client";
import { fileSize } from "@/lib/artist-mail-view";

export function FilesPicker({
  profile,
  files,
  onFiles,
  value,
  onChange,
  maxBytes,
}: {
  profile: MailProfile;
  files: MailFile[];
  onFiles: (files: MailFile[]) => void;
  value: string[];
  onChange: (ids: string[]) => void;
  maxBytes: number;
}) {
  const [on, setOn] = useState(value.length > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const add = (f: MailFile) => {
    onFiles([f, ...files]);
    onChange([...value, f.id]);
  };

  async function upload(file: File) {
    setError(null);
    if (file.size > maxBytes) {
      setError(`That file is ${fileSize(file.size)}; the limit is ${fileSize(maxBytes)}. Add a link to it instead.`);
      return;
    }
    setBusy(true);
    try {
      add(await uploadMailFile(profile, file));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That file didn't upload. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveLink() {
    if (!link) return;
    setBusy(true);
    setError(null);
    try {
      add(await addMailFileLink(profile, link.name, link.url));
      setLink(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That link didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(f: MailFile) {
    setBusy(true);
    try {
      await deleteMailFile(f.id);
      onFiles(files.filter((x) => x.id !== f.id));
      onChange(value.filter((id) => id !== f.id));
    } catch {
      setError(`${f.name} couldn't be removed. Try again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset>
      <label className="flex items-center gap-2 text-sm font-semibold text-fg">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            if (!e.target.checked) onChange([]);
          }}
        />
        <Paperclip aria-hidden="true" className="size-4 text-highlight" /> Include files (a gift or collectible)
      </label>
      {on ? (
        <div className="mt-3 grid gap-3 border-l-2 border-line pl-4">
          <p className="text-sm text-fg-muted">Each person gets their own download link under your message.</p>
          {files.length ? (
            <ul className="grid gap-1">
              {files.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 text-sm text-fg">
                  <label className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={value.includes(f.id)}
                      onChange={() => onChange(value.includes(f.id) ? value.filter((id) => id !== f.id) : [...value, f.id])}
                    />
                    <span className="truncate font-semibold">{f.name}</span>
                    <span className="shrink-0 text-xs text-fg-muted">{f.kind === "LINK" ? "Link" : fileSize(f.byte_size)}</span>
                  </label>
                  <button type="button" className="cr-focus text-fg-muted hover:text-fg" aria-label={`Remove ${f.name} from your files`} disabled={busy} onClick={() => void remove(f)}>
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg">No files yet.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <input ref={input} type="file" className="sr-only" tabIndex={-1} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            <Button size="sm" variant="secondary" type="button" busy={busy && !link} onClick={() => input.current?.click()}>
              <FileUp aria-hidden="true" /> Upload a file
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setLink(link ? null : { name: "", url: "https://" })}>
              <Link2 aria-hidden="true" /> Add a link instead
            </Button>
          </div>
          {link ? (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
              <label className="grid gap-1 text-xs font-semibold text-fg">
                What people get
                <Input value={link.name} onChange={(e) => setLink({ ...link, name: e.target.value })} placeholder="Signed poster (PDF)" maxLength={200} />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-fg">
                Web address
                <Input value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} inputMode="url" maxLength={2000} />
              </label>
              <Button size="sm" type="button" busy={busy} disabled={!link.name.trim() || !/^https?:\/\/\S+\.\S+/.test(link.url)} onClick={() => void saveLink()}>
                Add
              </Button>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
