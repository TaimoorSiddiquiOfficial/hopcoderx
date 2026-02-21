{
  lib,
  stdenvNoCC,
  callPackage,
  bun,
  sysctl,
  makeBinaryWrapper,
  models-dev,
  ripgrep,
  installShellFiles,
  versionCheckHook,
  writableTmpDirAsHomeHook,
  node_modules ? callPackage ./node-modules.nix { },
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "hopcoderx";
  inherit (node_modules) version src;
  inherit node_modules;

  nativeBuildInputs = [
    bun
    installShellFiles
    makeBinaryWrapper
    models-dev
    writableTmpDirAsHomeHook
  ];

  configurePhase = ''
    runHook preConfigure

    cp -R ${finalAttrs.node_modules}/. .

    runHook postConfigure
  '';

  env.MODELS_DEV_API_JSON = "${models-dev}/dist/_api.json";
  env.HOPCODERX_DISABLE_MODELS_FETCH = true;
  env.HOPCODERX_VERSION = finalAttrs.version;
  env.HOPCODERX_CHANNEL = "local";

  buildPhase = ''
    runHook preBuild

    cd ./packages/hopcoderx
    bun --bun ./script/build.ts --single --skip-install
    bun --bun ./script/schema.ts schema.json

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -Dm755 dist/hopcoderx-*/bin/hopcoderx $out/bin/hopcoderx
    install -Dm644 schema.json $out/share/hopcoderx/schema.json

    wrapProgram $out/bin/hopcoderx \
      --prefix PATH : ${
        lib.makeBinPath (
          [
            ripgrep
          ]
          # bun runs sysctl to detect if dunning on rosetta2
          ++ lib.optional stdenvNoCC.hostPlatform.isDarwin sysctl
        )
      }

    runHook postInstall
  '';

  postInstall = lib.optionalString (stdenvNoCC.buildPlatform.canExecute stdenvNoCC.hostPlatform) ''
    # trick yargs into also generating zsh completions
    installShellCompletion --cmd hopcoderx \
      --bash <($out/bin/hopcoderx completion) \
      --zsh <(SHELL=/bin/zsh $out/bin/hopcoderx completion)
  '';

  nativeInstallCheckInputs = [
    versionCheckHook
    writableTmpDirAsHomeHook
  ];
  doInstallCheck = true;
  versionCheckKeepEnvironment = [ "HOME" "HOPCODERX_DISABLE_MODELS_FETCH" ];
  versionCheckProgramArg = "--version";

  passthru = {
    jsonschema = "${placeholder "out"}/share/hopcoderx/schema.json";
  };

  meta = {
    description = "The open source coding agent";
    homepage = "https://hopcoderx.ai/";
    license = lib.licenses.mit;
    mainProgram = "hopcoderx";
    inherit (node_modules.meta) platforms;
  };
})
