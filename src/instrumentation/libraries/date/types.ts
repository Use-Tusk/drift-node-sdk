import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TuskDriftMode } from "../../../core/TuskDrift";

export interface DateInstrumentationConfig extends TdInstrumentationConfig {
  mode?: TuskDriftMode;
}