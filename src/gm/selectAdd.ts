/**
 * Shared "+ Add New X" sentinel pattern for `<select>` dropdowns.
 *
 * Used by Map Selection and Marker (and any future dropdown that wants the
 * same look). Each select gets a trailing disabled separator option and a
 * green action option. Picking the action option fires the sentinel value
 * via the select's normal `change` event; the caller's change handler
 * detects the sentinel and dispatches the add flow, then reverts or rebuilds
 * the dropdown so it doesn't sit on the action item.
 */

/** Value carried by every "+ Add" sentinel option. Test against this in your
 *  change handler to dispatch the add flow. */
export const SELECT_ADD_SENTINEL = '__add__';

/** Append a separator + a green "+" action option to `select`. The action
 *  option uses the `select-option--add` CSS class for bold-green styling. */
export function appendAddOption(select: HTMLSelectElement, label: string): void {
  const sep = document.createElement('option');
  sep.disabled = true;
  sep.textContent = '──────────';
  select.appendChild(sep);

  const addOpt = document.createElement('option');
  addOpt.value = SELECT_ADD_SENTINEL;
  addOpt.textContent = label;
  addOpt.className = 'select-option--add';
  select.appendChild(addOpt);
}
