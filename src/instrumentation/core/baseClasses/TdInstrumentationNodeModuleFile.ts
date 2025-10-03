import { normalize } from "path";

export type PatchFunction = (moduleExports: any, moduleVersion?: string) => any;

export class TdInstrumentationNodeModuleFile {
  name: string;
  supportedVersions: string[];
  patch: PatchFunction;
  moduleExports?: any;

  constructor({
    name,
    supportedVersions,
    patch,
  }: {
    name: string;
    supportedVersions: string[];
    patch: PatchFunction;
  }) {
    this.name = normalize(name);
    this.supportedVersions = supportedVersions;
    this.patch = patch;
  }
}
