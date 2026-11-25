import * as alphaTab from "@coderline/alphatab";

type Note = alphaTab.model.Note;
type Beat = alphaTab.model.Beat;
type AlphaTabApi = alphaTab.AlphaTabApi;
type Track = alphaTab.model.Track;

export interface NoteEdit {
    id: string;
    type: "transpose_string" | "change_fret" | "change_duration" | "delete_note" | "add_note";
    timestamp: string;
    track: number;
    bar: number;
    voice: number;
    beat: number;
    note?: number;
    from?: Record<string, any>;
    to?: Record<string, any>;
}

export interface NoteEditorController {
    selectNote(note: Note): void;
    clearSelection(): void;
    getSelectedNote(): Note | null;
    transposeToString(targetString: number): NoteEdit | null;
    changeFret(newFret: number): NoteEdit | null;
    applyEdit(edit: NoteEdit): void;
    applyEdits(edits: NoteEdit[]): void;
    getEditHistory(): NoteEdit[];
    loadEditsFromBackend(): Promise<void>;
    saveEditsToBackend(): Promise<void>;
}

/**
 * Find the note under the pointer
 */
function getNoteFromEvent(container: HTMLElement, api: AlphaTabApi, e: MouseEvent | PointerEvent): Note | undefined {
    const parentPos = container.getBoundingClientRect();
    const parentLeft = parentPos.left + container.ownerDocument.defaultView!.pageXOffset;
    const parentTop = parentPos.top + container.ownerDocument.defaultView!.pageYOffset;
    const relX = e.pageX - parentLeft;
    const relY = e.pageY - parentTop;

    const beat = api.boundsLookup?.getBeatAtPos(relX, relY);
    if (!beat) {
        return undefined;
    }

    const bounds = api.boundsLookup!.findBeat(beat);
    if (!bounds || !bounds.notes) {
        return undefined;
    }

    // Find which note was clicked based on Y position
    for (const noteBounds of bounds.notes) {
        if (relX >= noteBounds.noteHeadBounds.x &&
            relX <= noteBounds.noteHeadBounds.x + noteBounds.noteHeadBounds.w &&
            relY >= noteBounds.noteHeadBounds.y &&
            relY <= noteBounds.noteHeadBounds.y + noteBounds.noteHeadBounds.h) {
            return noteBounds.note;
        }
    }

    return undefined;
}

/**
 * Calculate MIDI pitch for a note
 */
function getRealValue(note: Note, track: Track): number {
    if (!track.tuning || note.string >= track.tuning.length) {
        return 0;
    }
    return track.tuning[note.string] + note.fret;
}

/**
 * Find note coordinates in score hierarchy
 */
function findNoteCoordinates(note: Note): { track: number; bar: number; voice: number; beat: number; note: number } | null {
    const beat = note.beat;
    if (!beat) return null;

    const voice = beat.voice;
    if (!voice) return null;

    const bar = voice.bar;
    if (!bar) return null;

    const staff = bar.staff;
    if (!staff) return null;

    const track = staff.track;
    if (!track) return null;

    const noteIndex = beat.notes.indexOf(note);
    if (noteIndex === -1) return null;

    return {
        track: track.index,
        bar: bar.index,
        voice: voice.index,
        beat: beat.index,
        note: noteIndex
    };
}

/**
 * Setup note-level editing for the AlphaTab score
 */
export function setupNoteEditor(container: HTMLElement, api: AlphaTabApi, tabId: string): NoteEditorController {
    let selectedNote: Note | null = null;
    const editHistory: NoteEdit[] = [];

    // Visual indicator for selected note
    const noteHighlight = document.createElement("div");
    noteHighlight.className = "at-note-highlight";
    noteHighlight.style.position = "absolute";
    noteHighlight.style.border = "2px solid #007bff";
    noteHighlight.style.borderRadius = "50%";
    noteHighlight.style.pointerEvents = "none";
    noteHighlight.style.display = "none";
    noteHighlight.style.zIndex = "1000";
    container.appendChild(noteHighlight);

    function updateNoteHighlight(note: Note | null) {
        if (!note) {
            noteHighlight.style.display = "none";
            return;
        }

        const bounds = api.boundsLookup?.findBeat(note.beat!);
        if (!bounds || !bounds.notes) {
            noteHighlight.style.display = "none";
            return;
        }

        const noteBounds = bounds.notes.find(nb => nb.note === note);
        if (!noteBounds) {
            noteHighlight.style.display = "none";
            return;
        }

        noteHighlight.style.display = "block";
        noteHighlight.style.left = `${noteBounds.noteHeadBounds.x - 4}px`;
        noteHighlight.style.top = `${noteBounds.noteHeadBounds.y - 4}px`;
        noteHighlight.style.width = `${noteBounds.noteHeadBounds.w + 8}px`;
        noteHighlight.style.height = `${noteBounds.noteHeadBounds.h + 8}px`;
    }

    // Click handler for note selection
    function onNoteClick(e: MouseEvent) {
        const note = getNoteFromEvent(container, api, e);
        if (note) {
            selectedNote = note;
            updateNoteHighlight(note);
            console.log("Selected note:", {
                fret: note.fret,
                string: note.string,
                coords: findNoteCoordinates(note)
            });
        } else {
            selectedNote = null;
            updateNoteHighlight(null);
        }
    }

    container.addEventListener("click", onNoteClick);

    // Re-highlight on render
    api.renderFinished.on(() => {
        if (selectedNote) {
            updateNoteHighlight(selectedNote);
        }
    });

    return {
        selectNote(note: Note) {
            selectedNote = note;
            updateNoteHighlight(note);
        },

        clearSelection() {
            selectedNote = null;
            updateNoteHighlight(null);
        },

        getSelectedNote(): Note | null {
            return selectedNote;
        },

        transposeToString(targetString: number): NoteEdit | null {
            if (!selectedNote) return null;

            const coords = findNoteCoordinates(selectedNote);
            if (!coords) return null;

            const track = api.score!.tracks[coords.track];
            const currentPitch = getRealValue(selectedNote, track);

            if (!track.tuning || targetString >= track.tuning.length) {
                console.error("Invalid target string or tuning not available");
                return null;
            }

            const stringTuning = track.tuning[targetString];
            const newFret = currentPitch - stringTuning;

            if (newFret < 0 || newFret > 24) {
                console.error("Target fret out of range:", newFret);
                return null;
            }

            const edit: NoteEdit = {
                id: crypto.randomUUID(),
                type: "transpose_string",
                timestamp: new Date().toISOString(),
                track: coords.track,
                bar: coords.bar,
                voice: coords.voice,
                beat: coords.beat,
                note: coords.note,
                from: { string: selectedNote.string, fret: selectedNote.fret },
                to: { string: targetString, fret: newFret }
            };

            this.applyEdit(edit);
            return edit;
        },

        changeFret(newFret: number): NoteEdit | null {
            if (!selectedNote) return null;

            const coords = findNoteCoordinates(selectedNote);
            if (!coords) return null;

            if (newFret < 0 || newFret > 24) {
                console.error("Target fret out of range:", newFret);
                return null;
            }

            const edit: NoteEdit = {
                id: crypto.randomUUID(),
                type: "change_fret",
                timestamp: new Date().toISOString(),
                track: coords.track,
                bar: coords.bar,
                voice: coords.voice,
                beat: coords.beat,
                note: coords.note,
                from: { fret: selectedNote.fret },
                to: { fret: newFret }
            };

            this.applyEdit(edit);
            return edit;
        },

        applyEdit(edit: NoteEdit) {
            const track = api.score!.tracks[edit.track];
            const bar = track.staves[0].bars[edit.bar];
            const voice = bar.voices[edit.voice];
            const beat = voice.beats[edit.beat];

            if (edit.note !== undefined && edit.note < beat.notes.length) {
                const note = beat.notes[edit.note];

                switch (edit.type) {
                    case "transpose_string":
                        if (edit.to?.string !== undefined) note.string = edit.to.string;
                        if (edit.to?.fret !== undefined) note.fret = edit.to.fret;
                        break;
                    case "change_fret":
                        if (edit.to?.fret !== undefined) note.fret = edit.to.fret;
                        break;
                }

                selectedNote = note;
            }

            editHistory.push(edit);

            // Re-render and update MIDI
            api.render();
            api.loadMidiForScore();
            updateNoteHighlight(selectedNote);

            // Store edit to backend
            this.saveEditsToBackend();
        },

        applyEdits(edits: NoteEdit[]) {
            edits.forEach(edit => this.applyEdit(edit));
        },

        getEditHistory(): NoteEdit[] {
            return [...editHistory];
        },

        async loadEditsFromBackend() {
            try {
                const res = await fetch(`/api/tab/${tabId}/edits`, {
                    credentials: "include"
                });
                const data = await res.json();
                if (data.edits && Array.isArray(data.edits)) {
                    // Apply all loaded edits
                    data.edits.forEach((edit: NoteEdit) => {
                        const track = api.score!.tracks[edit.track];
                        const bar = track.staves[0].bars[edit.bar];
                        const voice = bar.voices[edit.voice];
                        const beat = voice.beats[edit.beat];

                        if (edit.note !== undefined && edit.note < beat.notes.length) {
                            const note = beat.notes[edit.note];

                            switch (edit.type) {
                                case "transpose_string":
                                    if (edit.to?.string !== undefined) note.string = edit.to.string;
                                    if (edit.to?.fret !== undefined) note.fret = edit.to.fret;
                                    break;
                                case "change_fret":
                                    if (edit.to?.fret !== undefined) note.fret = edit.to.fret;
                                    break;
                            }
                        }
                        editHistory.push(edit);
                    });

                    if (editHistory.length > 0) {
                        // Re-render and update MIDI
                        api.render();
                        api.loadMidiForScore();
                        console.log(`Loaded ${editHistory.length} edits from backend`);
                    }
                }
            } catch (e) {
                console.error("Failed to load edits:", e);
            }
        },

        async saveEditsToBackend() {
            try {
                await fetch(`/api/tab/${tabId}/edits`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ edits: editHistory })
                });
            } catch (e) {
                console.error("Failed to save edits:", e);
            }
        }
    };
}
