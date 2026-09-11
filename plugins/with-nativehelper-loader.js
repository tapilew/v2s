const { withMainApplication } = require("expo/config-plugins");

const marker = "// @generated begin v2s-nativehelper-loader";

// Bare Kit links this public ART library. On Android 17 it lives in an APEX,
// outside SoLoader's directory sources. Delegate only that dependency to the
// system linker; keep React Native's merged mapping and other sources intact.
const initialization = `${marker}
com.facebook.soloader.SoLoader.init(
  this,
  com.facebook.react.soloader.OpenSourceMergedSoMapping
)
com.facebook.soloader.SoLoader.prependSoSource(
  object : com.facebook.soloader.SystemLoadWrapperSoSource() {
    override fun loadLibrary(
      soName: String,
      loadFlags: Int,
      threadPolicy: android.os.StrictMode.ThreadPolicy?
    ): Int {
      return if (soName == "libnativehelper.so") {
        super.loadLibrary(soName, loadFlags, threadPolicy)
      } else {
        com.facebook.soloader.SoSource.LOAD_RESULT_NOT_FOUND
      }
    }
  }
)
// @generated end v2s-nativehelper-loader`;

module.exports = function withNativeHelperLoader(config) {
	return withMainApplication(config, (mod) => {
		if (mod.modResults.language !== "kt") {
			throw new Error(
				"V2S nativehelper loader requires Kotlin MainApplication.",
			);
		}
		const { contents } = mod.modResults;
		if (contents.includes(marker)) return mod;

		const anchor = /^([\t ]*)super\.onCreate\(\)[\t ]*$/gm;
		if ([...contents.matchAll(anchor)].length !== 1) {
			throw new Error(
				"V2S nativehelper loader could not locate a unique super.onCreate(); review the Expo Android template.",
			);
		}
		// Run before any React Native startup. Its later SoLoader.init is
		// idempotent and uses the same OpenSourceMergedSoMapping.
		mod.modResults.contents = contents.replace(anchor, (line, indent) => {
			const block = initialization
				.split("\n")
				.map((entry) => indent + entry)
				.join("\n");
			return `${line}\n${block}`;
		});
		return mod;
	});
};
