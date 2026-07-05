import { describe, expectTypeOf, it } from 'vitest';
import type {
  MountedTBRecord as DbMountedTBRecord,
  MountedTMRecord as DbMountedTMRecord,
  ProjectFileRecord as DbProjectFileRecord,
  ProjectSavedPromptRecord as DbProjectSavedPromptRecord,
  TBRecord as DbTBRecord,
  TMRecord as DbTMRecord,
  TMType as DbTMType,
} from '../../../../packages/db/src/types';
import type {
  ImportOptions as SharedImportOptions,
  MountedTB,
  MountedTM,
  ProjectFileRecord,
  ProjectSavedPrompt,
  TBImportOptions,
  TBRecord,
  TMImportOptions,
  TMRecord,
  TMType,
} from './ipc';
import type {
  ImportOptions as PortsImportOptions,
  MountedTBRecord as PortsMountedTBRecord,
  MountedTMRecord as PortsMountedTMRecord,
  ProjectFileRecord as PortsProjectFileRecord,
  ProjectSavedPromptRecord as PortsProjectSavedPromptRecord,
  TBRecord as PortsTBRecord,
  TMRecord as PortsTMRecord,
  TMType as PortsTMType,
} from '../main/services/ports';
import type { TMModule } from '../main/services/modules/TMModule';
import type { TBModule } from '../main/services/modules/TBModule';
import type { SpreadsheetFilter } from '../main/filters/SpreadsheetFilter';

describe('contract consistency', () => {
  it('keeps db/shared/main DTOs aligned for TM/TB/Project records', () => {
    expectTypeOf<TMType>().toEqualTypeOf<DbTMType>();
    expectTypeOf<TMType>().toEqualTypeOf<PortsTMType>();

    expectTypeOf<ProjectFileRecord>().toEqualTypeOf<DbProjectFileRecord>();
    expectTypeOf<ProjectFileRecord>().toEqualTypeOf<PortsProjectFileRecord>();

    expectTypeOf<ProjectSavedPrompt>().toEqualTypeOf<DbProjectSavedPromptRecord>();
    expectTypeOf<ProjectSavedPrompt>().toEqualTypeOf<PortsProjectSavedPromptRecord>();

    expectTypeOf<TMRecord>().toEqualTypeOf<DbTMRecord>();
    expectTypeOf<TMRecord>().toEqualTypeOf<PortsTMRecord>();
    expectTypeOf<MountedTM>().toEqualTypeOf<DbMountedTMRecord & { entryCount: number }>();
    expectTypeOf<PortsMountedTMRecord>().toEqualTypeOf<DbMountedTMRecord>();

    expectTypeOf<TBRecord>().toEqualTypeOf<DbTBRecord>();
    expectTypeOf<TBRecord>().toEqualTypeOf<PortsTBRecord>();
    expectTypeOf<MountedTB>().toEqualTypeOf<
      DbMountedTBRecord & { stats: { entryCount: number } }
    >();
    expectTypeOf<PortsMountedTBRecord>().toEqualTypeOf<DbMountedTBRecord>();
  });

  it('binds import option contracts to shared definitions', () => {
    type TMImportParam = Parameters<TMModule['importTMEntries']>[2];
    type TBImportParam = Parameters<TBModule['importTBEntries']>[2];
    type SpreadsheetImportParam = Parameters<SpreadsheetFilter['import']>[3];

    expectTypeOf<TMImportParam>().toEqualTypeOf<TMImportOptions>();
    expectTypeOf<TBImportParam>().toEqualTypeOf<TBImportOptions>();
    expectTypeOf<SpreadsheetImportParam>().toEqualTypeOf<SharedImportOptions>();
    expectTypeOf<PortsImportOptions>().toEqualTypeOf<SharedImportOptions>();
  });
});
