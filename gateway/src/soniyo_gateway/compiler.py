"""Builder spec → engine caption and parameters. Pure: no I/O, no settings object."""

from .schemas import BuilderSpec, CompileResult


def compile_spec(spec: BuilderSpec, *, lm_cap_seconds: int) -> CompileResult:
    raise NotImplementedError  # implemented by the compiler workstream
