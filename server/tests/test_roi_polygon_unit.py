#!/usr/bin/env python3
"""
Unit Tests for ROI Polygon Ray-Casting Algorithm.
Verifies point-in-polygon math across rectangular, arbitrary, normalized,
and boundary edge cases.
"""
import pytest
from ACAP.run_simulation_test import Point2D, is_point_in_polygon

def test_rectangular_roi_inside():
    rect = [Point2D(0.1, 0.1), Point2D(0.8, 0.1), Point2D(0.8, 0.8), Point2D(0.1, 0.8)]
    inside_point = Point2D(0.5, 0.5)
    assert is_point_in_polygon(inside_point, rect) is True

def test_rectangular_roi_outside():
    rect = [Point2D(0.1, 0.1), Point2D(0.8, 0.1), Point2D(0.8, 0.8), Point2D(0.1, 0.8)]
    outside_point = Point2D(0.05, 0.05)
    assert is_point_in_polygon(outside_point, rect) is False

def test_arbitrary_polygon():
    # L-shaped polygon
    poly = [
        Point2D(0.0, 0.0), Point2D(1.0, 0.0), Point2D(1.0, 0.5),
        Point2D(0.5, 0.5), Point2D(0.5, 1.0), Point2D(0.0, 1.0)
    ]
    assert is_point_in_polygon(Point2D(0.2, 0.2), poly) is True
    assert is_point_in_polygon(Point2D(0.2, 0.8), poly) is True
    assert is_point_in_polygon(Point2D(0.8, 0.8), poly) is False

def test_pixel_coordinates():
    poly = [Point2D(100, 100), Point2D(500, 100), Point2D(500, 400), Point2D(100, 400)]
    assert is_point_in_polygon(Point2D(300, 250), poly) is True
    assert is_point_in_polygon(Point2D(50, 50), poly) is False

def test_empty_or_line_polygon():
    assert is_point_in_polygon(Point2D(0.5, 0.5), []) is False
    assert is_point_in_polygon(Point2D(0.5, 0.5), [Point2D(0, 0), Point2D(1, 1)]) is False
