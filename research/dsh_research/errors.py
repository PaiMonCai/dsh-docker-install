"""Exception hierarchy used by the shared Research engine."""


class ResearchError(RuntimeError):
    """Base class for user-facing Research engine errors."""


class ProjectNotFoundError(ResearchError):
    """Raised when no Research Project root can be found."""


class InvalidConfigError(ResearchError):
    """Raised when a YAML/JSON project document has an invalid top-level shape."""


class ManifestError(ResearchError):
    """Raised when a manifest cannot be parsed or written safely."""
