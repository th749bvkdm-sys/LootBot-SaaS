export type PrivateQuantFigure = { fileName: string; relativePath: string; fileHash: string; sourcePage: number; kind: 'stem_diagram' | 'question_without_key'; review: { status: 'reviewed' | 'needs_review'; note: string } };
export function quantProjectRoot(cwd?: string): string;
export function quantFigureStorageRoot(projectRoot?: string): string;
export function validateFigureMetadata(figure: PrivateQuantFigure, sourcePage: number): { relativePath: string; fileHash: string; fileName: string; sourcePage: number; reviewNote: string };
export function readPrivateQuantFigure(storageRoot: string, relativePath: string, expectedHash: string, projectRoot?: string): Promise<{ bytes: Buffer; width: number; height: number; size: number }>;
