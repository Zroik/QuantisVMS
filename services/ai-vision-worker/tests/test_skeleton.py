from src import WORKER_VERSION, get_class_weight


def test_worker_version():
    assert WORKER_VERSION == "1.0.0"


def test_class_weights_errata_e1():
    # person=3, vehicle=2, pet=1, other=1
    assert get_class_weight(0) == 3   # person
    assert get_class_weight(2) == 2   # car
    assert get_class_weight(16) == 1  # dog
    assert get_class_weight(24) == 1  # backpack (other)

