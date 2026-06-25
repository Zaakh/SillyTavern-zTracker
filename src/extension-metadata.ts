// Folder name under SillyTavern's `scripts/extensions/third-party/`.
// This must match the actual install folder name; otherwise template URLs will 404.
export const extensionName = 'SillyTavern-zTracker';
export const EXTENSION_KEY = 'zTracker';
export const CHAT_METADATA_SCHEMA_PRESET_KEY = 'schemaKey';
export const DEFAULT_MODULE_ID = 'default';
export const CHAT_METADATA_MODULES_KEY = 'byModule';

function isRecord(value: unknown): value is Record<string, any> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getExtensionChatMetadataRecord(chatMetadata: unknown, createIfMissing = false): Record<string, any> | undefined {
	if (!isRecord(chatMetadata)) {
		return undefined;
	}

	if (!isRecord(chatMetadata[EXTENSION_KEY])) {
		if (!createIfMissing) {
			return undefined;
		}
		chatMetadata[EXTENSION_KEY] = {};
	}

	return chatMetadata[EXTENSION_KEY] as Record<string, any>;
}

export function migrateLegacyChatMetadataToModules(chatMetadata: unknown): boolean {
	const extensionMetadata = getExtensionChatMetadataRecord(chatMetadata);
	if (!extensionMetadata || isRecord(extensionMetadata[CHAT_METADATA_MODULES_KEY])) {
		return false;
	}

	const legacySchemaKey = extensionMetadata[CHAT_METADATA_SCHEMA_PRESET_KEY];
	if (typeof legacySchemaKey !== 'string' || legacySchemaKey.trim().length === 0) {
		return false;
	}

	extensionMetadata[CHAT_METADATA_MODULES_KEY] = {
		[DEFAULT_MODULE_ID]: {
			[CHAT_METADATA_SCHEMA_PRESET_KEY]: legacySchemaKey,
		},
	};
	delete extensionMetadata[CHAT_METADATA_SCHEMA_PRESET_KEY];
	return true;
}

export function getModuleChatMetadataRecord(
	chatMetadata: unknown,
	moduleId = DEFAULT_MODULE_ID,
	createIfMissing = false,
): Record<string, any> | undefined {
	const extensionMetadata = getExtensionChatMetadataRecord(chatMetadata, createIfMissing);
	if (!extensionMetadata) {
		return undefined;
	}

	migrateLegacyChatMetadataToModules(chatMetadata);

	if (!isRecord(extensionMetadata[CHAT_METADATA_MODULES_KEY])) {
		if (!createIfMissing) {
			return undefined;
		}
		extensionMetadata[CHAT_METADATA_MODULES_KEY] = {};
	}

	const modules = extensionMetadata[CHAT_METADATA_MODULES_KEY] as Record<string, any>;
	if (!isRecord(modules[moduleId])) {
		if (!createIfMissing) {
			return undefined;
		}
		modules[moduleId] = {};
	}

	return modules[moduleId] as Record<string, any>;
}

export function readModuleChatSchemaPresetKey(chatMetadata: unknown, moduleId = DEFAULT_MODULE_ID): string | undefined {
	const moduleMetadata = getModuleChatMetadataRecord(chatMetadata, moduleId);
	const storedSchemaKey = moduleMetadata?.[CHAT_METADATA_SCHEMA_PRESET_KEY];
	return typeof storedSchemaKey === 'string' && storedSchemaKey.trim().length > 0 ? storedSchemaKey : undefined;
}

export function writeModuleChatSchemaPresetKey(
	chatMetadata: unknown,
	schemaPresetKey: string | undefined,
	moduleId = DEFAULT_MODULE_ID,
): boolean {
	const moduleMetadata = getModuleChatMetadataRecord(chatMetadata, moduleId, schemaPresetKey !== undefined);
	if (!moduleMetadata) {
		return false;
	}
	if (schemaPresetKey === undefined) {
		delete moduleMetadata[CHAT_METADATA_SCHEMA_PRESET_KEY];
		return true;
	}
	moduleMetadata[CHAT_METADATA_SCHEMA_PRESET_KEY] = schemaPresetKey;
	return true;
}
