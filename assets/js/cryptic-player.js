/* A dependency-free, data-driven player for one-answer cryptic clues. */
(() => {
  "use strict";
  const ROLES = ["definition", "indicator", "fodder"];
  const CATEGORIES = ["definition", "indicator", "fodder", "general"];
  const LABELS = { definition: "Definition", indicator: "Indicator", fodder: "Fodder", general: "Hint" };
  const emptyLevels = () => Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  const normalize = (value) => String(value || "").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z]/g, "");

  function validatePuzzles(raw) {
    if (!Array.isArray(raw) || !raw.length) throw new Error("cryptics.yml needs a nonempty list.");
    const ids = new Set();
    return raw.map((entry) => {
      const answer = normalize(entry.answer);
      if (typeof entry.id !== "string" || !/^[a-z0-9-]+$/.test(entry.id) || ids.has(entry.id)) {
        throw new Error("Each clue needs a unique lowercase, hyphenated id.");
      }
      ids.add(entry.id);
      if (!answer || answer.length > 40) throw new Error("Use an answer of 1–40 letters.");
      if (!Array.isArray(entry.parts) || !entry.parts.length) throw new Error("Each clue needs parts.");
      const parts = entry.parts.map((part) => {
        if (typeof part.text !== "string") throw new Error("Each clue part needs text.");
        const roles = part.roles || [];
        if (!Array.isArray(roles) || roles.some((role) => !ROLES.includes(role))) {
          throw new Error("Part roles must be definition, indicator, or fodder.");
        }
        return { text: part.text, roles: roles };
      });
      const hints = {};
      CATEGORIES.forEach((category) => {
        const list = (entry.hints || {})[category] || [];
        if (!Array.isArray(list) || list.some((hint) => typeof hint !== "string")) {
          throw new Error("Hint categories must contain lists of text.");
        }
        hints[category] = list;
      });
      return {
        id: entry.id, title: entry.title || entry.id, answer: answer,
        enumeration: String(entry.enumeration || answer.length),
        parts: parts, hints: hints, explanation: String(entry.explanation || "")
      };
    });
  }

  function init(root) {
    if (root.dataset.ready) return;
    root.dataset.ready = "true";
    const $ = (name) => root.querySelector("[data-" + name + "]");
    const status = $("status");
    const say = (message, tone, visuallyHidden) => {
      status.textContent = message;
      status.dataset.tone = tone || "";
      status.classList.toggle("cryptic-sr-only", Boolean(visuallyHidden));
    };
    let puzzles;
    try { puzzles = validatePuzzles(JSON.parse($("puzzle-data").textContent)); }
    catch (error) {
      console.error("Cryptic player:", error);
      say("These clues could not be loaded. Please try again later.", "error");
      root.querySelectorAll("button, input, select").forEach((el) => { el.disabled = true; });
      return;
    }

    let puzzle, state, fields = [], partNodes = [], hintButtons = {};
    const select = $("puzzle-select");
    const storageKey = () => "cryptic-player:v1:" + location.pathname + ":" + puzzle.id;
    const signature = () => {
      // Preserve existing progress for clues that do not add general hints.
      const hints = { ...puzzle.hints };
      if (!hints.general.length) delete hints.general;
      return JSON.stringify({ ...puzzle, hints: hints });
    };
    const emptyState = () => ({
      letters: Array(puzzle.answer.length).fill(""),
      revealed: Array(puzzle.answer.length).fill(false),
      history: [], active: 0, mode: "playing"
    });
    function levels() {
      const result = emptyLevels();
      state.history.forEach((category) => { result[category]++; });
      return result;
    }
    function save() {
      try { localStorage.setItem(storageKey(), JSON.stringify({ signature: signature(), state: state })); }
      catch (_) { /* Play continues when browser storage is unavailable. */ }
    }
    function restore() {
      const fresh = emptyState();
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey()));
        if (!stored || stored.signature !== signature()) return fresh;
        const old = stored.state;
        if (!old || !Array.isArray(old.letters) || old.letters.length !== fresh.letters.length) return fresh;
        fresh.letters = old.letters.map((value) => /^[A-Z]$/.test(value) ? value : "");
        fresh.revealed = fresh.revealed.map((_, i) => Boolean((old.revealed || [])[i]));
        fresh.revealed.forEach((value, i) => { if (value) fresh.letters[i] = puzzle.answer[i]; });
        const used = emptyLevels();
        (Array.isArray(old.history) ? old.history : []).forEach((category) => {
          if (CATEGORIES.includes(category) && used[category] < puzzle.hints[category].length) {
            fresh.history.push(category);
            used[category]++;
          }
        });
        if (Number.isInteger(old.active)) fresh.active = Math.max(0, Math.min(old.active, fresh.letters.length - 1));
        if (["solved", "revealed"].includes(old.mode) && fresh.letters.join("") === puzzle.answer) fresh.mode = old.mode;
      } catch (_) { /* Missing or malformed saved state starts a fresh clue. */ }
      return fresh;
    }
    function renderActive() {
      fields.forEach((field, i) => { field.classList.toggle("is-active", i === state.active); });
    }
    function focusActive() {
      const field = fields[state.active];
      field.focus();
      field.select();
    }
    function moveTo(index) {
      state.active = Math.max(0, Math.min(index, fields.length - 1));
      renderActive();
      save();
      focusActive();
    }
    function nextEditable(index, direction) {
      for (let i = index; i >= 0 && i < fields.length; i += direction) {
        if (!state.revealed[i]) return i;
      }
      return -1;
    }
    function render() {
      const used = levels(), finished = state.mode !== "playing";
      root.classList.toggle("is-solved", state.mode === "solved");
      fields.forEach((field, i) => {
        if (field.value !== state.letters[i]) field.value = state.letters[i];
        field.readOnly = finished || state.revealed[i];
        field.classList.toggle("is-revealed", state.revealed[i]);
        field.setAttribute("aria-label", "Letter " + (i + 1) + " of " + fields.length +
          (state.revealed[i] ? ", revealed" : ""));
      });
      partNodes.forEach((node, i) => {
        ROLES.forEach((category) => {
          const completed = puzzle.hints[category].length > 0 &&
            used[category] === puzzle.hints[category].length;
          node.classList.toggle("hint-" + category, completed && puzzle.parts[i].roles.includes(category));
        });
      });
      CATEGORIES.forEach((category) => {
        const button = hintButtons[category];
        if (!button) return;
        button.textContent = LABELS[category];
        button.disabled = finished || used[category] >= puzzle.hints[category].length;
      });
      const counts = emptyLevels();
      const logItems = state.history.map((category) => {
        const li = document.createElement("li"), strong = document.createElement("strong");
        const index = counts[category]++;
        strong.textContent = LABELS[category] + " " + (index + 1) + ": ";
        li.append(strong, document.createTextNode(puzzle.hints[category][index]));
        return li;
      });
      $("hint-log").replaceChildren(...logItems);
      $("hint-log").hidden = !logItems.length;
      $("check").disabled = finished;
      $("reveal-answer").disabled = finished;
      $("reveal-letter").disabled = finished || state.revealed[state.active];
      $("progress").textContent = "Hints used: " + state.history.length +
        " · Letters revealed: " + state.revealed.filter(Boolean).length;
      $("solution").hidden = !finished;
      $("solution-answer").textContent = puzzle.answer;
      $("explanation").textContent = puzzle.explanation;
      renderActive();
    }
    function changed() {
      say("");
      save();
      render();
    }
    function applyText(index, text, alignToGrid) {
      if (state.mode !== "playing") return;
      const letters = normalize(text);
      let cursor = index, last = index;
      for (const letter of letters) {
        if (!alignToGrid) cursor = nextEditable(cursor, 1);
        if (cursor < 0 || cursor >= fields.length) break;
        if (!state.revealed[cursor]) state.letters[cursor] = letter;
        last = cursor++;
      }
      state.active = nextEditable(last + 1, 1);
      if (state.active < 0) state.active = last;
      changed();
      focusActive();
    }
    function onKey(event, index) {
      if (event.key === "ArrowLeft") { event.preventDefault(); moveTo(index - 1); }
      else if (event.key === "ArrowRight") { event.preventDefault(); moveTo(index + 1); }
      else if (event.key === "Home") { event.preventDefault(); moveTo(0); }
      else if (event.key === "End") { event.preventDefault(); moveTo(fields.length - 1); }
      else if (["Backspace", "Delete"].includes(event.key) && state.mode === "playing") {
        event.preventDefault();
        let target = index;
        if (event.key === "Backspace" && (!state.letters[index] || state.revealed[index])) {
          target = nextEditable(index - 1, -1);
        }
        if (target >= 0 && !state.revealed[target]) {
          state.letters[target] = "";
          state.active = target;
          changed();
          focusActive();
        }
      }
    }
    function openHint(category) {
      const index = levels()[category];
      if (state.mode !== "playing" || index >= puzzle.hints[category].length) return;
      state.history.push(category);
      save();
      render();
      const prefix = category === "general" ? "Hint" : LABELS[category] + " hint";
      say(prefix + ": " + puzzle.hints[category][index], "", true);
    }
    function load(id) {
      puzzle = puzzles.find((entry) => entry.id === id) || puzzles[0];
      select.value = puzzle.id;
      state = restore();
      $("enumeration").textContent = "(" + puzzle.enumeration + ")";
      partNodes = puzzle.parts.map((part) => {
        const span = document.createElement("span");
        span.textContent = part.text;
        return span;
      });
      $("clue").replaceChildren(...partNodes);
      fields = Array.from(puzzle.answer, (_, index) => {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "cryptic-letter";
        input.maxLength = 1;
        input.autocomplete = "off";
        input.setAttribute("autocapitalize", "characters");
        input.setAttribute("inputmode", "text");
        input.spellcheck = false;
        input.addEventListener("focus", () => {
          state.active = index;
          renderActive();
          $("reveal-letter").disabled = state.mode !== "playing" || state.revealed[index];
          save();
          input.select();
        });
        input.addEventListener("input", () => {
          if (state.mode !== "playing" || state.revealed[index]) return;
          if (normalize(input.value)) applyText(index, input.value, normalize(input.value).length > 1);
          else { state.letters[index] = ""; changed(); }
        });
        input.addEventListener("keydown", (event) => onKey(event, index));
        input.addEventListener("paste", (event) => {
          event.preventDefault();
          if (event.clipboardData) applyText(index, event.clipboardData.getData("text/plain"), true);
        });
        return input;
      });
      $("letter-grid").replaceChildren(...fields);
      $("letter-grid").classList.toggle("is-long", fields.length > 10);
      hintButtons = {};
      $("hint-buttons").replaceChildren();
      CATEGORIES.forEach((category) => {
        if (!puzzle.hints[category].length) return;
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.hint = category;
        button.addEventListener("click", () => openHint(category));
        hintButtons[category] = button;
        $("hint-buttons").append(button);
      });
      say(state.mode === "solved" ? "You have solved this clue." :
        state.mode === "revealed" ? "The solution has been revealed." : "");
      render();
    }
    function hashId() {
      try { return decodeURIComponent(location.hash.slice(1)); }
      catch (_) { return ""; }
    }
    puzzles.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.title;
      select.append(option);
    });
    select.addEventListener("change", () => {
      history.replaceState(null, "", location.pathname + location.search + "#" + encodeURIComponent(select.value));
      load(select.value);
    });
    window.addEventListener("hashchange", () => {
      const id = hashId();
      if (puzzles.some((entry) => entry.id === id)) load(id);
    });
    $("answer-form").addEventListener("submit", (event) => {
      event.preventDefault();
      if (state.mode !== "playing") return;
      if (state.letters.some((letter) => !letter)) {
        say("Enter all " + fields.length + " letters before checking.", "error");
      } else if (state.letters.join("") === puzzle.answer) {
        state.mode = "solved";
        save();
        render();
        say("Correct! You solved the clue.", "success");
      } else say("Not quite. Try again, or choose a hint.", "error");
    });
    $("reveal-letter").addEventListener("click", () => {
      if (state.mode !== "playing" || state.revealed[state.active]) return;
      const index = state.active;
      state.letters[index] = puzzle.answer[index];
      state.revealed[index] = true;
      let next = nextEditable(index + 1, 1);
      if (next < 0) next = nextEditable(0, 1);
      if (next < 0) state.mode = "revealed";
      else state.active = next;
      save();
      render();
      say("Letter " + (index + 1) + " is " + puzzle.answer[index] + ".");
      if (state.mode === "playing") focusActive();
    });
    $("reveal-answer").addEventListener("click", () => {
      if (state.mode !== "playing") return;
      state.letters = Array.from(puzzle.answer);
      state.revealed = state.revealed.map(() => true);
      state.mode = "revealed";
      save();
      render();
      say("The answer and explanation have been revealed.");
    });
    $("reset").addEventListener("click", () => {
      state = emptyState();
      save();
      render();
      say("Clue reset.");
      focusActive();
    });
    load(hashId());
  }
  function start() { document.querySelectorAll("[data-cryptic-player]").forEach(init); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
