export function getTopLevelSchemaKeys(schema: any): string[] {
  const props = schema?.properties;
  if (!props || typeof props !== 'object') {
    return [];
  }
  return Object.keys(props);
}

export function buildTopLevelPartSchema(schema: any, partKey: string): any {
  const partDef = schema?.properties?.[partKey];
  if (!partDef) {
    throw new Error(`Unknown schema part: ${partKey}`);
  }

  const partSchema: any = {
    $schema: schema?.$schema ?? 'http://json-schema.org/draft-07/schema#',
    title: `${schema?.title ?? 'SceneTracker'}Part`,
    type: 'object',
    properties: {
      [partKey]: partDef,
    },
    required: [partKey],
  };

  // Preserve definitions when present (future-proofing for presets that rely on them).
  if (schema?.definitions) {
    partSchema.definitions = schema.definitions;
  }
  if (schema?.$defs) {
    partSchema.$defs = schema.$defs;
  }

  return partSchema;
}

export function mergeTrackerPart(currentTracker: any, partKey: string, partObject: any): any {
  if (!partObject || typeof partObject !== 'object') {
    throw new Error('Part response must be an object');
  }
  if (!(partKey in partObject)) {
    throw new Error(`Part response missing key: ${partKey}`);
  }

  const base = currentTracker && typeof currentTracker === 'object' ? currentTracker : {};
  return {
    ...base,
    [partKey]: (partObject as any)[partKey],
  };
}
