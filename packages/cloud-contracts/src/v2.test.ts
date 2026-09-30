import { describe, expect, it } from 'vitest';
import {
  parseProjectManifestV2,
  parseResourceManifestV2,
  projectManifestHashesV2,
  resourceManifestHashesV2,
  type ProjectManifestV2,
} from './index';

const hash = 'a'.repeat(64);
const project: ProjectManifestV2 = {
  protocol: 2,
  schema: 15,
  state: [hash],
  files: [{ id: 'file-uuid', chunks: [hash] }],
  resources: [{ id: 'shared-tm', kind: 'tm' }],
};

describe('cloud V2 transport manifests', () => {
  it('keeps independently identified resources outside project blob hashes', () => {
    const parsed = parseProjectManifestV2(project);
    expect(parsed).toEqual(project);
    expect(projectManifestHashesV2(parsed)).toEqual([hash]);
    expect(
      resourceManifestHashesV2(
        parseResourceManifestV2({
          protocol: 2,
          schema: 15,
          kind: 'tb',
          data: [hash, hash],
        }),
      ),
    ).toEqual([hash]);
    expect(parsed.state).not.toBe(project.state);
    expect(parsed.files[0].chunks).not.toBe(project.files[0].chunks);
  });

  it.each([
    { ...project, protocol: 1 },
    { ...project, schema: 14 },
    { ...project, state: [] },
    { ...project, state: ['not-a-hash'] },
    { ...project, files: [{ id: 3, chunks: [hash] }] },
    { ...project, files: [...project.files, ...project.files] },
    { ...project, resources: [{ id: 'tm', kind: 'working' }] },
    {
      ...project,
      resources: [
        { id: 'tm', kind: 'tm' },
        { id: 'tm', kind: 'tb' },
      ],
    },
    { ...project, resources: [{ id: '../tm', kind: 'tm' }] },
    { ...project, ignored: 'unsupported' },
    { ...project, files: [{ ...project.files[0], path: '/private/file' }] },
    { ...project, resources: [{ ...project.resources[0], revision: 1 }] },
  ])('rejects unsupported or ambiguous project transport %j', (value) => {
    expect(() => parseProjectManifestV2(value)).toThrow();
  });

  it('bounds file, resource and total chunk counts while allowing an empty original file', () => {
    expect(
      parseProjectManifestV2({ ...project, files: [{ id: 'empty', chunks: [] }] }).files,
    ).toEqual([{ id: 'empty', chunks: [] }]);
    expect(() =>
      parseProjectManifestV2({
        ...project,
        files: Array.from({ length: 101 }, (_, i) => ({ id: `file-${i}`, chunks: [] })),
      }),
    ).toThrow();
    expect(() =>
      parseProjectManifestV2({
        ...project,
        resources: Array.from({ length: 101 }, (_, i) => ({ id: `tm-${i}`, kind: 'tm' })),
      }),
    ).toThrow();
    const hashes = Array.from({ length: 257 }, (_, i) => i.toString(16).padStart(64, '0'));
    expect(() =>
      parseProjectManifestV2({
        ...project,
        state: hashes.slice(0, 128),
        files: [
          { id: 'one', chunks: hashes.slice(128, 256) },
          { id: 'two', chunks: hashes.slice(256) },
        ],
      }),
    ).toThrow('too large');
  });

  it.each([
    { protocol: 1, schema: 15, kind: 'tm', data: [hash] },
    { protocol: 2, schema: 15, kind: 'working', data: [hash] },
    { protocol: 2, schema: 15, kind: 'tm', data: [] },
    { protocol: 2, schema: 15, kind: 'tb', data: [hash], srcLang: 'en' },
  ])('rejects unsupported resource transport %j', (value) => {
    expect(() => parseResourceManifestV2(value)).toThrow();
  });
});
