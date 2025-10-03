import { TdInstrumentationNodeModuleFile, PatchFunction } from "./TdInstrumentationNodeModuleFile";

export class TdInstrumentationNodeModule {
  name: string;
  supportedVersions: string[];
  patch?: PatchFunction;
  files: TdInstrumentationNodeModuleFile[];
  moduleExports?: any;
  moduleVersion?: string;

  constructor({
    name,
    supportedVersions,
    patch,
    files,
  }: {
    name: string;
    supportedVersions: string[];
    patch?: PatchFunction;
    files?: TdInstrumentationNodeModuleFile[];
  }) {
    this.name = name;
    this.supportedVersions = supportedVersions;
    this.patch = patch;
    this.files = files ?? [];
  }
}
