from pydantic import ValidationError
import pytest

from app.core.robot_config import RobotSettings


def test_robot_gateway_reads_dotenv_outside_working_directory(tmp_path, monkeypatch):
    path = tmp_path / '.env'
    token = 'fixture-lan-token-' + 'x' * 32
    path.write_text(
        'AI_SERVER_ROBOT_ENABLED=true\n'
        'AI_SERVER_ROBOT_AI_MODE=gemini\n'
        'AI_SERVER_ROBOT_ENERGY_THRESHOLD=300\n'
        'AI_SERVER_ROBOT_ALLOWED_NETWORKS=["192.168.1.0/24"]\n'
        f'AI_SERVER_ROBOT_TOKEN={token}\n'
        'GEMINI_API_KEY=unrelated-fixture-key\n', encoding='utf-8')
    monkeypatch.chdir(tmp_path.parent)
    settings = RobotSettings(_env_file=path)
    assert settings.enabled and settings.ai_mode == 'gemini'
    assert settings.allowed_networks == ['192.168.1.0/24']
    assert settings.token.get_secret_value() == token
    assert token not in repr(settings)
    monkeypatch.setenv('AI_SERVER_ROBOT_ENABLED', 'false')
    assert not RobotSettings(_env_file=path).enabled


def test_robot_dotenv_missing_token_fails_closed(tmp_path):
    path = tmp_path / '.env'
    path.write_text('AI_SERVER_ROBOT_ENABLED=true\n'
                    'AI_SERVER_ROBOT_ENERGY_THRESHOLD=300\n', encoding='utf-8')
    with pytest.raises(ValidationError, match='Development token'):
        RobotSettings(_env_file=path)


def test_robot_dotenv_public_network_is_rejected(tmp_path):
    path = tmp_path / '.env'
    path.write_text('AI_SERVER_ROBOT_ALLOWED_NETWORKS=["0.0.0.0/0"]\n', encoding='utf-8')
    with pytest.raises(ValidationError, match='private networks'):
        RobotSettings(_env_file=path)
