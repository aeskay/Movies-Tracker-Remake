# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# ---- Capacitor / WebView ----
# Keep Capacitor bridge classes intact so the JS<->Native bridge works
-keep class com.getcapacitor.** { *; }
-keep class com.getcapacitor.plugin.** { *; }
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ---- Firebase ----
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# ---- Capacitor Firebase Authentication ----
-keep class io.capawesome.capacitorjs.plugins.firebase.** { *; }
-dontwarn com.facebook.**
-dontwarn com.twitter.**

# ---- Capacitor Camera ----
-keep class com.capacitorjs.plugins.camera.** { *; }

# ---- AndroidX / Support ----
-keep class androidx.** { *; }
-dontwarn androidx.**

# ---- Preserve line numbers for stack traces ----
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
