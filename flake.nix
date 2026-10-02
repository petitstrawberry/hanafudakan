{
  description = "花札館 — self-hosted Rust and WebGPU koi-koi";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { self, nixpkgs }:
    let
      version = (builtins.head (libVersionData.releases)).version;
      libVersionData = builtins.fromJSON (builtins.readFile ./client/src/data/releases.json);
      systems = [
        "aarch64-linux"
        "x86_64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      eachSystem = nixpkgs.lib.genAttrs systems;
      perSystem = eachSystem (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          inherit (pkgs) lib;
          server = pkgs.rustPlatform.buildRustPackage {
            pname = "hanafudakan-server";
            inherit version;
            src = lib.fileset.toSource {
              root = ./.;
              fileset = lib.fileset.unions [
                ./Cargo.toml
                ./Cargo.lock
                ./server
              ];
            };
            cargoLock.lockFile = ./Cargo.lock;
            doCheck = true;
            meta.mainProgram = "hanafudakan-server";
          };
          client = pkgs.buildNpmPackage {
            pname = "hanafudakan-client";
            inherit version;
            src = lib.cleanSourceWith {
              src = ./client;
              filter =
                path: type:
                !(
                  builtins.elem (builtins.baseNameOf path) [
                    "node_modules"
                    "dist"
                    ".vite"
                    ".DS_Store"
                  ]
                  || lib.hasSuffix ".tsbuildinfo" path
                );
            };
            nodejs = pkgs.nodejs_22;
            nativeBuildInputs = [ pkgs.tsx ];
            # Every archive is fetched using its package-lock.json integrity.
            # No manually maintained aggregate dependency hash is necessary.
            npmDeps = pkgs.importNpmLock {
              package = lib.importJSON ./client/package.json;
              packageLock = lib.importJSON ./client/package-lock.json;
            };
            npmConfigHook = pkgs.importNpmLock.npmConfigHook;
            npmBuildScript = "build";
            doCheck = true;
            checkPhase = ''
              runHook preCheck
              npm test
              runHook postCheck
            '';
            installPhase = ''
              runHook preInstall
              mkdir -p "$out"
              cp -r dist/. "$out/"
              runHook postInstall
            '';
          };
          hanafudakan =
            pkgs.runCommand "hanafudakan-${version}"
              {
                nativeBuildInputs = [ pkgs.makeWrapper ];
                meta.mainProgram = "hanafudakan-server";
              }
              ''
                mkdir -p "$out/bin" "$out/share"
                makeWrapper ${server}/bin/hanafudakan-server "$out/bin/hanafudakan-server" \
                  --set-default STATIC_DIR ${client}
                ln -s ${client} "$out/share/hanafudakan"
              '';
          # Docker copies this output and its runtime closure into a scratch image.
          container = pkgs.symlinkJoin {
            name = "hanafudakan-container-${version}";
            paths = [
              hanafudakan
              pkgs.curl
              pkgs.cacert
            ];
          };
        in
        {
          packages = {
            inherit
              server
              client
              hanafudakan
              container
              ;
            default = hanafudakan;
          };
          apps.default = {
            type = "app";
            program = "${hanafudakan}/bin/hanafudakan-server";
            meta.description = "花札館 game server with the Web client";
          };
          checks = {
            inherit server client;
            versionConsistency = pkgs.runCommand "hanafudakan-version-check" { nativeBuildInputs = [ pkgs.nodejs_22 ]; } ''
              node ${./scripts/release-version.mjs} --check ${./.}
              touch "$out"
            '';
          };
          devShells.default = pkgs.mkShell {
            packages = with pkgs; [
              cargo
              rustc
              rustfmt
              clippy
              nodejs_22
              tsx
              pkg-config
            ];
            shellHook = ''
              printf '\n花札館 development shell\n  初回: cd client && npm ci && cd ..\n  起動: ./scripts/dev.sh\n\n'
            '';
          };
          formatter = pkgs.nixfmt;
        }
      );
    in
    {
      packages = eachSystem (system: perSystem.${system}.packages);
      apps = eachSystem (system: perSystem.${system}.apps);
      checks = eachSystem (system: perSystem.${system}.checks);
      devShells = eachSystem (system: perSystem.${system}.devShells);
      formatter = eachSystem (system: perSystem.${system}.formatter);
    };
}
