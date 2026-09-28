-- 07 · 트리거
-- 스냅샷: 2026-09-28 · 원본 DB 와 md5 대조 완료 (verify.sql)

CREATE TRIGGER braindump_touch BEFORE UPDATE ON public.braindump_blocks FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER date_tx_check_depositor BEFORE INSERT OR UPDATE OF depositor, book_id ON public.date_tx FOR EACH ROW EXECUTE FUNCTION date_tx_check_depositor();
CREATE TRIGGER goals_touch BEFORE UPDATE ON public.goals FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_study_cards_touch BEFORE UPDATE ON public.study_cards FOR EACH ROW EXECUTE FUNCTION study_cards_touch();
CREATE TRIGGER trade_log_touch BEFORE UPDATE ON public.trade_log FOR EACH ROW EXECUTE FUNCTION trade_log_touch();
