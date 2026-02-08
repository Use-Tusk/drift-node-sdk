{
  description = "A very basic flake";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
  };

  outputs =
    {
      self,
      nixpkgs,
    }:
    let
      x86-linux = "x86_64-linux";
      arm-linux = "aarch64-linux";
      arm-macos = "aarch64-darwin";

      defaultSystems = [
        x86-linux
        arm-linux
        arm-macos
      ];
      eachSystem =
        fun: systems:
        nixpkgs.lib.genAttrs systems (
          system:
          let
            pkgs = import nixpkgs {
              inherit system;
            };
          in
          fun pkgs
        );
    in
    {
      devShell = eachSystem (
        pkgs:
        with pkgs;
        mkShell {
          buildInputs = [
            (python3.withPackages (p: with p; [ ]))
          ];
        }
      ) defaultSystems;
    };

}
