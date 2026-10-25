// The version this Worker was built from: package.json's, which the open-source export sets per release.
import manifest from "../../../package.json";

export const INSTALLED_VERSION: string = manifest.version;
