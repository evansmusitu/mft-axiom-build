import unittest
from multiplatform.quality import known_answer_score


class KnownAnswerOracleTests(unittest.TestCase):
    def test_whole_answer_and_numeric_tolerance(self):
        case={"mode":"known_answer","expected":42}
        self.assertEqual(known_answer_score(case,"42"),1)
        self.assertEqual(known_answer_score(case,"42.000000001"),1)
        for text in ("420","42 is wrong; the correct answer is 999","The answer is 42",'"42"',"true","NaN"):
            self.assertEqual(known_answer_score(case,text),0,text)

    def test_complete_shapes_and_boolean_types(self):
        for expected,wrong in [({},'{"extra":42}'),([],"[42]"),({"value":42},'{"value":420}'),(True,"1")]:
            case={"mode":"known_answer","expected":expected}
            self.assertEqual(known_answer_score(case,wrong),0)
        self.assertEqual(known_answer_score({"mode":"known_answer","expected":{"value":42}},'{"value":42}'),1)

    def test_rubrics_never_get_a_heuristic_pass(self):
        self.assertIsNone(known_answer_score({"mode":"rubric"},"42"))
        with self.assertRaises(ValueError):known_answer_score({"mode":"known_answer"},"42")
        with self.assertRaises(ValueError):known_answer_score({"mode":"known_answer","expected":42,"relative_tolerance":float('nan')},"42")

if __name__=='__main__':unittest.main()
