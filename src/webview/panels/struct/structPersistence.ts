import type { StructDef, StructPin } from '../../../core/types';
import { postProviderMessage } from '../../api';

export function persistStructs(structs: StructDef[]): void {
    postProviderMessage({ type: 'saveStructs', structs });
}

export function persistStructPins(pins: StructPin[]): void {
    postProviderMessage({ type: 'saveStructPins', pins });
}

export function persistStructState(structs: StructDef[], pins: StructPin[]): void {
    persistStructs(structs);
    persistStructPins(pins);
}
