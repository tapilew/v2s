const { withAndroidManifest } = require("expo/config-plugins");

// The QVAC plugin declares libOpenCL.so as a required native library, and Android
// refuses to install the APK on phones that do not expose it (Pixel, among others).
// QVAC only needs it for its optional OpenCL backend, so mark it optional.
// Expo runs manifest mods last-registered first, so this plugin must sit above
// @qvac/sdk/expo-plugin in app.json to see the entry that plugin adds.
module.exports = (config) =>
	withAndroidManifest(config, (config) => {
		const application = config.modResults.manifest.application?.[0];
		for (const lib of application?.["uses-native-library"] ?? []) {
			if (lib.$["android:name"] === "libOpenCL.so") {
				lib.$["android:required"] = "false";
			}
		}
		return config;
	});
