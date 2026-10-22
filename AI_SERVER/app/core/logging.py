"""Only lifecycle logging; no request tracing or task 07 logging system."""

import logging


def configure_logging(log_level: str) -> logging.Logger:
    logger = logging.getLogger("ai_server")
    level = 5 if log_level == "trace" else getattr(logging, log_level.upper())
    logger.setLevel(level)
    logger.propagate = False
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
        logger.addHandler(handler)
    return logger
