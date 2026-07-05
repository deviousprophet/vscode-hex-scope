import type { IntegrityCheckSet, IntegrityProfile } from '../../../core/integrity';
import { postProviderMessage } from '../../api';

export function copyIntegrityText(text: string, label: string): void {
    postProviderMessage({ type: 'copyText', text, label });
}

export function persistIntegrityChecks(state: IntegrityCheckSet): void {
    postProviderMessage({ type: 'saveIntegrityChecks', state });
}

export function createIntegrityProfile(profile: IntegrityProfile): void {
    postProviderMessage({ type: 'createIntegrityProfile', profile });
}

export function updateIntegrityProfile(profile: IntegrityProfile): void {
    postProviderMessage({ type: 'updateIntegrityProfile', profile });
}

export function renameIntegrityProfile(id: string, name: string): void {
    postProviderMessage({ type: 'renameIntegrityProfile', id, name });
}

export function deleteIntegrityProfile(id: string): void {
    postProviderMessage({ type: 'deleteIntegrityProfile', id });
}
