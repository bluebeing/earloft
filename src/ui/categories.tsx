import { useEffect, useState } from 'preact/hooks';
import { NO_CATEGORY, activePodcasts, createCategory, deleteCategory, moveCategory, renameCategory, togglePodcastCategory } from '../library';
import { readLocal, writeLocal } from '../storage';
import { emit, useStore } from '../store';
import { Header, useDismiss } from './common';
import { CheckIcon, PlusIcon } from './icons';

/** Klíč, pod kterým si obrazovka pamatuje zvolenou kategorii (jen na tomto zařízení). */
export const categoryFilterKey = (screen: string) => `podcasty.cat.${screen}`;

/** Zvolená kategorie zapamatovaná pro danou obrazovku. */
export function useCategoryFilter(screen: string): [string | null, (v: string | null) => void] {
  const storageKey = categoryFilterKey(screen);
  const [value, setValue] = useState<string | null>(() => readLocal(storageKey));
  const s = useStore();
  // Smazaná kategorie → zpět na „Vše“
  const valid = value === null || value === NO_CATEGORY || s.categories.some((c) => c.id === value) ? value : null;
  const choose = (v: string | null) => {
    setValue(v);
    writeLocal(storageKey, v);
    emit(); // boční panel zvýrazní zvolenou kategorii
  };
  return [valid, choose];
}

export function CategoryChips({
  value,
  onChange,
  showManage,
  allowAll = true,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  showManage?: boolean;
  allowAll?: boolean;
}) {
  const s = useStore();
  if (!s.categories.length) {
    return showManage ? (
      <div class="chips">
        <a class="chip ghost" href="#/categories">
          <PlusIcon size={14} /> Kategorie
        </a>
      </div>
    ) : null;
  }
  return (
    <div class="chips">
      {allowAll && (
        <button class={`chip${value === null ? ' on' : ''}`} onClick={() => onChange(null)}>
          Vše
        </button>
      )}
      {s.categories.map((c) => (
        <button class={`chip${value === c.id ? ' on' : ''}`} onClick={() => onChange(c.id)}>
          {c.name}
        </button>
      ))}
      <button class={`chip${value === NO_CATEGORY ? ' on' : ''}`} onClick={() => onChange(NO_CATEGORY)}>
        Bez kategorie
      </button>
      {showManage && (
        <a class="chip ghost" href="#/categories">
          Upravit
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Výběr kategorií pro podcast (bottom sheet)

let openPicker: ((podcastId: string | null) => void) | null = null;
export const pickCategories = (podcastId: string) => openPicker?.(podcastId);

export function CategoryPickerHost() {
  const s = useStore();
  const [podcastId, setPodcastId] = useState<string | null>(null);
  useEffect(() => {
    openPicker = setPodcastId;
    return () => void (openPicker = null);
  }, []);
  const { ref, closing, close } = useDismiss(() => setPodcastId(null), !!podcastId);
  if (!podcastId) return null;

  return (
    <div class={`sheet-backdrop${closing ? ' closing' : ''}`} onClick={close}>
      <div class="action-sheet" ref={ref} onClick={(e) => e.stopPropagation()}>
        <div class="action-group">
          <div class="action-title">Kategorie podcastu</div>
          {s.categories.map((c) => {
            const on = c.podcastIds.includes(podcastId);
            return (
              <button class="action check-row" onClick={() => void togglePodcastCategory(c.id, podcastId)}>
                <span>{c.name}</span>
                <span class={`check${on ? ' on' : ''}`}>{on && <CheckIcon size={16} />}</span>
              </button>
            );
          })}
          <NewCategoryForm class="new-category" podcastId={podcastId} />
        </div>
        <button class="action action-cancel" onClick={close}>
          Hotovo
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Správa kategorií

export function CategoriesPage() {
  const s = useStore();
  const active = new Set(activePodcasts().map((p) => p.id));

  return (
    <div class="screen">
      <Header title="Kategorie" back />
      <p class="hint">
        Podcasty do kategorií přiřadíš v detailu podcastu (tlačítko kategorií pod názvem). Jeden podcast může být ve více kategoriích.
      </p>
      <div class="form-group">
        {s.categories.map((c, i) => (
          <div class="form-row category-row">
            <input
              class="category-name"
              value={c.name}
              onChange={(e) => void renameCategory(c.id, (e.target as HTMLInputElement).value)}
              aria-label="Název kategorie"
            />
            <span class="muted small">{c.podcastIds.filter((id) => active.has(id)).length}</span>
            <button class="icon-btn small" disabled={i === 0} onClick={() => void moveCategory(c.id, -1)} aria-label="Posunout nahoru">
              ↑
            </button>
            <button
              class="icon-btn small"
              disabled={i === s.categories.length - 1}
              onClick={() => void moveCategory(c.id, 1)}
              aria-label="Posunout dolů"
            >
              ↓
            </button>
            <button
              class="icon-btn small destructive"
              onClick={() => confirm(`Smazat kategorii „${c.name}“? Podcasty zůstanou v knihovně.`) && void deleteCategory(c.id)}
              aria-label="Smazat"
            >
              ✕
            </button>
          </div>
        ))}
        <NewCategoryForm class="form-row new-category" />
      </div>
    </div>
  );
}

/** Políčko pro založení kategorie; s `podcastId` do ní podcast rovnou zařadí. */
function NewCategoryForm({ class: cls, podcastId }: { class: string; podcastId?: string }) {
  const [name, setName] = useState('');
  const add = async (e: Event) => {
    e.preventDefault();
    const value = name.trim();
    if (!value) return;
    setName('');
    await createCategory(value, podcastId);
  };
  return (
    <form class={cls} onSubmit={add}>
      <input placeholder="Nová kategorie" value={name} enterKeyHint="done" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      <button class="icon-btn add" disabled={!name.trim()} aria-label="Přidat kategorii">
        <PlusIcon size={18} />
      </button>
    </form>
  );
}
