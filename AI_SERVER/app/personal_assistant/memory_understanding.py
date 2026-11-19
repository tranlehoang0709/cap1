"""Group III interpretation guards; no memory reader, writer or Backend calls."""
import re
import unicodedata

from app.personal_assistant.schema import MemoryUnderstanding


def _fold(value):
    return ''.join(c for c in unicodedata.normalize('NFD', value.lower().replace('đ', 'd'))
                   if unicodedata.category(c) != 'Mn')


_PROHIBITED = {
    'otp': r'\b(?:otp|ma xac thuc|ma xac nhan|ma dung mot lan|one.time password)\b',
    'password': r'\b(?:mat khau|password|passcode|ma pin)\b',
    'payment': r'\b(?:thanh toan|so the|cvv|cvc|so tai khoan|tai khoan ngan hang|the tin dung)\b',
    'identity': r'\b(?:cccd|cmnd|can cuoc|ho chieu|passport|giay to dinh danh|so an sinh)\b',
    'medical': r'\b(?:benh an|benh|y te|chan doan|toa thuoc|don thuoc|dieu tri|tieu duong|hiv)\b',
    'business_secret': r'\b(?:bi mat (?:doanh nghiep|cong ty|kinh doanh|thuong mai)|'
                       r'thong tin bao mat (?:doanh nghiep|cong ty)|trade secret|ma nguon noi bo)\b',
    'sensitive_other': r'\b(?:thong tin nhay cam|bi mat ca nhan|private key|secret key|api key|'
                       r'access token|refresh token|khoa bi mat)\b',
}
_INTERACTIONS = {'statement': 'propose', 'proposal': 'propose', 'save_request': 'create',
    'update_request': 'update', 'query_request': 'query', 'delete_request': 'delete',
    'decline': 'cancel', 'confirmation': 'confirm'}
_LEGACY = {'propose': 'statement', 'create': 'save_request', 'update': 'update_request',
    'query': 'query_request', 'delete': 'delete_request', 'cancel': 'decline', 'confirm': 'confirmation'}


def prepare_memory(op):
    if op.feature != 'PA-04':
        op.memory = None
        return
    op.memory = op.memory or MemoryUnderstanding(interaction=_LEGACY.get(op.action, 'statement'))
    text = _fold(op.source_text)
    if (op.memory.interaction in ('statement', 'proposal') and re.fullmatch(
            r'(?:hay|vui long|lam on|nho ban)\s+(?:ghi nho|luu)(?:\s+giup toi)?[.!?\s]*', text)):
        op.memory.interaction = 'save_request'
    if op.memory.interaction == 'decline' and re.search(r'\b(?:khong chac|hinh nhu|co le|khong ro)\b', text):
        refusal = re.search(r'\b(?:(?:khong|chua)(?: muon| can)? (?:luu|ghi nho)|'
                            r'dung (?:luu|ghi nho)|khong dong y|tu choi|khoi luu)\b', text)
        if not refusal:
            op.memory.interaction = 'statement'
            op.memory.issues = list(dict.fromkeys(op.memory.issues + ['ambiguous']))
            op.target_resolution = 'not_needed'
    op.action = _INTERACTIONS[op.memory.interaction]
    if op.action == 'update':
        # Recover only an explicitly quoted selector, never a Backend record ID.
        if not op.entities.target_query:
            match = re.search(r'^(?:hãy\s+|vui lòng\s+)?(?:thay(?:\s+thế)?|sửa|cập nhật)\s+'
                              r'(?:trí nhớ(?:\s+về)?\s+)?(.+?)\s+(?:đã\s+lưu\s+)?từ\s+',
                              op.source_text, re.IGNORECASE)
            if match:
                op.entities.target_query = match.group(1)
        modes = set(re.findall(r'\b(?:thay the|bo sung)\b', text))
        imperative = re.match(r'^(?:hay\s+|vui long\s+)?(?:thay|sua|cap nhat|bo sung)\b', text)
        uncertain = re.search(r'\b(?:khong|chua|co nen|co le|co the|hinh nhu)\b', text)
        if imperative and len(modes) == 1 and not uncertain:
            op.memory.issues = [issue for issue in op.memory.issues if issue != 'update_mode_unclear']


def guard_memory(op):
    prepare_memory(op)
    if op.feature != 'PA-04':
        return
    memory = op.memory
    memory.original_text = op.source_text
    # Keep verbatim evidence; a free paraphrase is never treated as verified meaning.
    memory.summary = None
    if op.action in ('create', 'propose') and op.entities.content:
        op.entities.content = op.source_text
    text = _fold(op.source_text)
    categories = [category for category, pattern in _PROHIBITED.items() if re.search(pattern, text)]
    memory.prohibited_categories = list(dict.fromkeys(memory.prohibited_categories + categories))
    issues = list(memory.issues)
    if op.action in ('create', 'propose', 'update') and not op.entities.content:
        issues.append('ambiguous')
    if re.search(r'\b(?:khong chac|hinh nhu|co le|khong ro)\b', text):
        issues.append('ambiguous')
    if re.search(r'\b(?:nghe sai|nghe nham|nhan dang sai|loi nhan dang|loi stt)\b', text):
        issues.append('possible_stt_error')
    memory.issues = list(dict.fromkeys(issues))
    memory.requires_clarification = bool(memory.issues)
    if memory.prohibited_categories:
        memory.storage_policy = 'PROHIBITED'
        if not op.entities.content and op.action in ('create', 'propose', 'update'):
            op.entities.content = op.source_text
        if 'memory_storage_prohibited' not in op.constraints:
            op.constraints.append('memory_storage_prohibited')
        if op.action not in ('query', 'delete', 'cancel'):
            op.state = 'unsupported'
            op.confirmation_required = False
            op.confirmation_prompt = None
            op.questions = []
    elif memory.interaction == 'decline':
        memory.storage_policy = 'DECLINED'
    elif memory.requires_clarification:
        memory.storage_policy = 'CLARIFICATION_REQUIRED'
        op.state = 'missing_information'
        if 'memory_clarification' not in op.missing_fields:
            op.missing_fields.append('memory_clarification')
        op.questions = ['Bạn xác nhận lại nội dung thông tin vừa nói được không? Tôi chưa lưu thông tin này.']
    elif op.action == 'query':
        memory.storage_policy = 'READ_ONLY'
    else:
        memory.storage_policy = 'CONSENT_REQUIRED'
    if op.action == 'query':
        op.confirmation_required = False
        op.confirmation_prompt = None
        if op.state == 'awaiting_confirmation':
            op.state = 'proposed'
    if memory.prohibited_categories and op.action in ('query', 'delete') and op.state == 'unsupported':
        op.state = ('missing_information' if op.missing_fields else 'awaiting_selection'
                    if op.target_resolution == 'selection_required' else 'awaiting_confirmation'
                    if op.confirmation_required else 'proposed')
    op.memory = memory
