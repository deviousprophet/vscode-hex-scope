export type PickerAction = 'compare' | 'swap' | 'cancel';

export const BROWSE_ITEM_LABEL = 'Browse…';

export interface PickerItem {
    label: string;
    description?: string;
    /** File path for a real candidate; absent on the Browse entry. */
    uri?: string;
    browse?: boolean;
}

export function pickerBasename(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
}

/** Open-editor candidates for the second file: basename label, full path description. */
export function openEditorItems(paths: readonly string[], basePath: string): PickerItem[] {
    return paths
        .filter(path => path !== basePath)
        .map(path => ({ label: pickerBasename(path), description: path, uri: path }));
}

export function comparisonConfirmItems(baseName: string, otherName: string): string[] {
    return [`Compare ${baseName} ↔ ${otherName}`, 'Swap', 'Cancel'];
}

export function actionForChoice(choice: string | undefined, baseName: string, otherName: string): PickerAction {
    if (choice === `Compare ${baseName} ↔ ${otherName}`) { return 'compare'; }
    if (choice === 'Swap') { return 'swap'; }
    return 'cancel';
}
