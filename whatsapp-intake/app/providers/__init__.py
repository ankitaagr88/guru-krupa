from app.config import ClinicConfig
from app.providers.base import Provider


def build_provider(clinic: ClinicConfig) -> Provider:
    if clinic.provider.kind == "meta_cloud":
        from app.providers.meta_cloud import MetaCloudProvider
        return MetaCloudProvider(clinic.provider)
    from app.providers.console import ConsoleProvider
    return ConsoleProvider()


__all__ = ["Provider", "build_provider"]
