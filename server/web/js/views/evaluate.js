/**
 * Evaluate a call: pick the recording, say who it is and which job it is
 * for, optionally steer the scoring — then upload, start the evaluation and
 * hand over to the report screen, which shows progress until it is ready.
 */

import { h, mount } from "../dom.js";
import { icon } from "../icons.js";
import { Jobs, Presets, Recordings, invalidateRecordings, upload } from "../api.js";
import { navigate } from "../router.js";
import { setActive } from "../shell.js";
import * as C from "../components.js";
import * as F from "../format.js";

const AUDIO_EXT = [".mp3", ".m4a", ".aac", ".amr", ".awb", ".wav", ".ogg", ".oga", ".opus", ".3gp", ".3gpp", ".flac", ".wma", ".mp4", ".caf", ".aiff"];
const MAX_INSTRUCTIONS = 2000;
const MIN_JD = 40;
const MAX_UPLOAD = 500 * 1024 * 1024;

export async function evaluateView({ query, signal, main }) {
  setActive("evaluate");
  const header = C.topbar({ title: "Evaluate a call" });
  mount(main, header, h("div", { class: "page page-narrow" }, h("div", { class: "stack gap-16" }, C.skelBlock(160), C.skelBlock(200), C.skelBlock(140))));

  let jobs = [];
  let presets = [];
  try {
    [jobs, presets] = await Promise.all([Jobs.list(false, { signal }), Presets.list({ signal })]);
  } catch (err) {
    if (err?.name === "AbortError") return;
    mount(main, header, h("div", { class: "page page-narrow" }, C.errorState(err)));
    return;
  }
  if (signal.aborted) return;

  const state = {
    file: null,
    jobMode: query.get("job") ? "existing" : jobs.length ? "existing" : "none",
    jobId: query.get("job") && jobs.some((j) => j.id === query.get("job")) ? query.get("job") : "",
  };

  // ── Recording ───────────────────────────────────────────────────────
  const fileInput = h("input", {
    type: "file",
    accept: ["audio/*", ...AUDIO_EXT].join(","),
    hidden: true,
    onChange: (e) => chooseFile(e.target.files?.[0]),
  });
  const fileSlot = h("div");
  const fileError = h("div", { class: "field-error", role: "alert", hidden: true });

  function chooseFile(file) {
    fileError.hidden = true;
    if (!file) return;
    const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
    if (!file.type.startsWith("audio/") && !AUDIO_EXT.includes(ext)) {
      fileError.textContent = `"${file.name}" isn't an audio file. Choose the call recording.`;
      fileError.hidden = false;
      return;
    }
    if (file.size > MAX_UPLOAD) {
      fileError.textContent = "That file is over 500 MB — too large to upload.";
      fileError.hidden = false;
      return;
    }
    state.file = file;
    if (!phone.value.trim()) {
      const guess = F.phoneFromFilename(file.name);
      if (guess) {
        phone.value = guess;
        phoneHint.textContent = "Taken from the file name — check it.";
      }
    }
    renderFile();
    validate();
  }

  function renderFile() {
    if (!state.file) {
      const zone = h(
        "div",
        {
          class: "dropzone",
          role: "button",
          tabindex: "0",
          "aria-label": "Choose a call recording",
          onClick: () => fileInput.click(),
          onKeydown: (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInput.click();
            }
          },
          onDragover: (e) => {
            e.preventDefault();
            zone.classList.add("is-over");
          },
          onDragleave: () => zone.classList.remove("is-over"),
          onDrop: (e) => {
            e.preventDefault();
            zone.classList.remove("is-over");
            chooseFile(e.dataTransfer?.files?.[0]);
          },
        },
        h("span", { class: "dropzone-icon" }, icon("upload")),
        h("div", { class: "strong" }, h("span", { class: "not-phone" }, "Drop the call recording here, or "), h("span", { class: "phone-only" }, "Tap to "), "choose a file"),
        h("div", { class: "faint small" }, "MP3, M4A, AMR, WAV and other recorder formats · up to 500 MB")
      );
      mount(fileSlot, zone);
    } else {
      mount(
        fileSlot,
        h(
          "div",
          { class: "file-card" },
          h("span", { class: "file-icon" }, icon("fileAudio")),
          h("div", { class: "grow" }, h("div", { class: "strong truncate", title: state.file.name }, state.file.name), h("div", { class: "faint small" }, F.fmtBytes(state.file.size))),
          C.btn({ label: "Change", size: "sm", onClick: () => fileInput.click() }),
          C.iconBtn({
            icon: "x",
            label: "Remove file",
            size: "sm",
            onClick: () => {
              state.file = null;
              fileInput.value = "";
              renderFile();
              validate();
            },
          })
        )
      );
    }
  }

  // ── Candidate ───────────────────────────────────────────────────────
  const name = h("input", { class: "input", id: "ev-name", maxlength: "200", autocomplete: "off", placeholder: "e.g. Priya Sharma" });
  const phone = h("input", { class: "input", id: "ev-phone", type: "tel", inputmode: "tel", maxlength: "40", autocomplete: "off", placeholder: "+91 …" });
  const phoneHint = h("span");
  phone.addEventListener("input", () => (phoneHint.textContent = ""));

  // ── Job ─────────────────────────────────────────────────────────────
  const jobSlot = h("div", { class: "stack gap-16" });
  const jobSelect = C.select({
    id: "ev-job",
    value: state.jobId,
    options: [{ value: "", label: "Choose a job…" }, ...jobs.map((j) => ({ value: j.id, label: j.title }))],
    onChange: (v) => {
      state.jobId = v;
      validate();
    },
  });
  const newTitle = h("input", { class: "input", id: "ev-title", maxlength: "200", placeholder: "e.g. Senior Data Engineer", onInput: validate });
  const newJd = h("textarea", { class: "textarea", id: "ev-jd", rows: "8", placeholder: "Paste the full job description", onInput: () => (updateJdCount(), validate()) });
  const jdCount = h("div", { class: "counter" });
  const jdStatus = h("span", { class: "faint small" });
  const jdFile = h("input", { type: "file", hidden: true, accept: ".pdf,.docx,.doc,.txt,.md", onChange: (e) => readJd(e.target.files?.[0], e.target) });
  function updateJdCount() {
    const n = newJd.value.trim().length;
    jdCount.textContent = n < MIN_JD ? `${n} / ${MIN_JD} characters minimum` : `${n} characters`;
    jdCount.classList.toggle("is-over", n > 0 && n < MIN_JD);
  }
  async function readJd(file, input) {
    if (!file) return;
    jdStatus.textContent = `Reading ${file.name}…`;
    try {
      const out = await Jobs.extractText(file);
      newJd.value = out.text;
      if (!newTitle.value.trim()) newTitle.value = file.name.replace(/\.[^.]+$/, "");
      jdStatus.textContent = `Loaded${out.pages ? ` ${F.plural(out.pages, "page")}` : ""} — check it below.`;
      updateJdCount();
      validate();
    } catch (err) {
      jdStatus.textContent = err.message;
    } finally {
      input.value = "";
    }
  }
  updateJdCount();

  function renderJob() {
    if (state.jobMode === "existing") {
      mount(
        jobSlot,
        jobs.length
          ? C.field({ label: "Job", id: "ev-job", hint: "The job description drives job-fit scoring." }, jobSelect)
          : C.note("info", "No jobs yet — add one with “New job”, or score without one.")
      );
    } else if (state.jobMode === "new") {
      mount(
        jobSlot,
        C.field({ label: "Job title", id: "ev-title" }, newTitle),
        C.field(
          { label: "Job description", id: "ev-jd", counter: jdCount },
          h("div", { class: "stack" }, newJd, h("div", { class: "row row-wrap" }, C.btn({ label: "Upload PDF or Word", icon: "fileText", size: "sm", onClick: () => jdFile.click() }), jdStatus), jdFile)
        )
      );
    } else {
      mount(jobSlot, C.note("info", "Scored without a job description: the answers and skills are still graded, but job fit isn't."));
    }
    validate();
  }

  // ── Instructions ────────────────────────────────────────────────────
  const instructions = h("textarea", {
    class: "textarea",
    id: "ev-instr",
    rows: "4",
    maxlength: String(MAX_INSTRUCTIONS),
    placeholder: "Optional — e.g. focus on the technical questions asked in the call",
    onInput: () => (updateInstrCount(), validate()),
  });
  const instrCount = h("div", { class: "counter" });
  function updateInstrCount() {
    const n = instructions.value.length;
    instrCount.textContent = n ? `${n} / ${MAX_INSTRUCTIONS}` : "";
    instrCount.classList.toggle("is-over", n > MAX_INSTRUCTIONS);
  }
  const presetSelect = presets.length
    ? C.select({
        label: "Saved instructions",
        value: "",
        options: [{ value: "", label: "Use saved instructions…" }, ...presets.map((p) => ({ value: p.id, label: p.label }))],
        onChange: (v) => {
          const p = presets.find((x) => x.id === v);
          if (p) {
            instructions.value = p.text;
            updateInstrCount();
            validate();
          }
        },
      })
    : null;
  const savePreset = h("input", { type: "checkbox", id: "ev-save", onChange: () => ((presetLabel.hidden = !savePreset.checked), validate()) });
  const presetLabel = h("input", { class: "input", placeholder: "Name these instructions, e.g. “Technical focus”", maxlength: "80", hidden: true, onInput: validate });

  // ── Submit ──────────────────────────────────────────────────────────
  const errorSlot = h("div");
  const submit = C.btn({ label: "Upload and evaluate", icon: "upload", variant: "primary", size: "lg", block: true, onClick: run });

  function validate() {
    let ok = !!state.file;
    if (state.jobMode === "existing") ok = ok && (jobs.length === 0 || !!state.jobId);
    if (state.jobMode === "new") ok = ok && newTitle.value.trim().length > 0 && newJd.value.trim().length >= MIN_JD;
    if (instructions.value.length > MAX_INSTRUCTIONS) ok = false;
    if (savePreset.checked && (!presetLabel.value.trim() || !instructions.value.trim())) ok = false;
    submit.disabled = !ok;
    return ok;
  }

  const sectionCard = (title, sub, ...content) =>
    h("div", { class: "card card-pad" }, h("div", { class: "stack gap-4", style: { marginBottom: "16px" } }, h("h2", { class: "h3" }, title), sub ? h("p", { class: "faint small" }, sub) : null), content);

  const form = h(
    "div",
    { class: "stack gap-16" },
    sectionCard("Call recording", "The recording from your phone's call recorder.", fileSlot, fileError, fileInput),
    sectionCard(
      "Candidate",
      null,
      h("div", { class: "field-row cols-2" }, C.field({ label: "Name", optional: true, id: "ev-name" }, name), C.field({ label: "Phone number", optional: true, id: "ev-phone" }, h("div", { class: "stack gap-4" }, phone, h("div", { class: "field-hint" }, phoneHint))))
    ),
    sectionCard(
      "Job",
      "What the candidate is being screened for.",
      C.seg({
        label: "Job",
        block: true,
        value: state.jobMode,
        options: [
          { value: "existing", label: "Existing job", icon: "briefcase" },
          { value: "new", label: "New job", icon: "plus" },
          { value: "none", label: "No job", icon: "x" },
        ],
        onChange: (v) => {
          state.jobMode = v;
          renderJob();
        },
      }),
      h("div", { class: "mt-16" }, jobSlot)
    ),
    sectionCard(
      "Scoring instructions",
      "Optional. Steers what the scoring emphasises — it can't loosen the evidence rules.",
      h("div", { class: "stack gap-12" }, presetSelect, instructions, instrCount, h("label", { class: "check", for: "ev-save" }, savePreset, "Save these instructions for reuse"), presetLabel)
    ),
    errorSlot,
    submit,
    h("p", { class: "faint small", style: { textAlign: "center" } }, "Transcription takes a few minutes for a long call. You can leave the page — the report will wait for you.")
  );

  const page = h("div", { class: "page page-narrow" }, h("div", { class: "intro not-phone" }, h("div", null, h("h2", { class: "h1" }, "Evaluate a call"), h("p", null, "Upload a screening call to get a scored report and a decision."))), form);
  mount(main, header, page);
  renderFile();
  renderJob();
  updateInstrCount();
  validate();

  async function run() {
    if (!validate()) return;
    mount(errorSlot);
    submit.disabled = true;
    const bar = h("div", { class: "progressbar-fill", style: { width: "0%" } });
    const pctEl = h("span", { class: "num strong" }, "0%");
    const stage = h("div", { class: "strong" }, "Uploading the recording…");
    const progress = h(
      "div",
      { class: "card card-pad" },
      h("div", { class: "row row-between gap-16" }, h("div", { class: "row gap-12", style: { minWidth: "0" } }, C.spinner(), h("div", { style: { minWidth: "0" } }, stage, h("div", { class: "faint small truncate" }, state.file.name))), pctEl),
      h("div", { class: "progressbar mt-16" }, bar)
    );
    form.replaceWith(progress);

    const fail = (err) => {
      progress.replaceWith(form);
      mount(errorSlot, C.banner({ icon: "alertTriangle", tone: "reject", text: err.message }));
      validate();
    };

    try {
      let jobId = state.jobMode === "existing" ? state.jobId : "";
      if (state.jobMode === "new") {
        stage.textContent = "Saving the job description…";
        const job = await Jobs.create({ title: newTitle.value.trim(), jdText: newJd.value.trim() });
        jobId = job.id;
        state.jobMode = "existing";
        jobs.unshift(job);
      }
      const steer = instructions.value.trim();
      if (savePreset.checked && steer) {
        await Presets.create({ label: presetLabel.value.trim(), text: steer }).catch(() => C.toast("Couldn't save the instructions for reuse", { tone: "reject" }));
        savePreset.checked = false;
      }
      stage.textContent = "Uploading the recording…";
      const payload = new FormData();
      payload.append("file", state.file);
      if (name.value.trim()) payload.append("candidateName", name.value.trim());
      if (jobId) payload.append("jobId", jobId);
      if (steer) payload.append("customInstructions", steer);
      const rec = await upload("/recordings", payload, {
        onProgress: (p) => {
          const pc = Math.round(p * 100);
          bar.style.width = `${pc}%`;
          pctEl.textContent = `${pc}%`;
          if (pc >= 100) stage.textContent = "Checking the audio…";
        },
      });
      stage.textContent = "Starting the evaluation…";
      if (phone.value.trim()) await Recordings.update(rec.id, { phoneNumber: phone.value.trim() }).catch(() => {});
      await Recordings.evaluate(rec.id);
      invalidateRecordings();
      navigate(`/candidates/${rec.id}`);
    } catch (err) {
      if (err?.name === "AbortError") return;
      fail(err);
    }
  }
}
