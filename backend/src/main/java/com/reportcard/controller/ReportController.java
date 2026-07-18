package com.reportcard.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class ReportController {

    @GetMapping("/students")
    public List<Map<String, Object>> getStudents() {
        return List.of(
                Map.of("id", 1, "name", "Amina Bello", "className", "JSS 1", "average", 88.5),
                Map.of("id", 2, "name", "Chinedu Okafor", "className", "JSS 2", "average", 91.0),
                Map.of("id", 3, "name", "Grace Thompson", "className", "SS 1", "average", 84.0)
        );
    }

    @GetMapping("/summary")
    public Map<String, Object> getSummary() {
        return Map.of(
                "totalStudents", 3,
                "averagePerformance", 87.8,
                "topPerformer", "Chinedu Okafor"
        );
    }
}
