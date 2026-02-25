// swift-tools-version: 6.0
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "ManifoldHub",
    platforms: [
        .iOS(.v17)
    ],
    products: [
        .library(
            name: "ManifoldHub",
            targets: ["ManifoldHub"]
        ),
    ],
    dependencies: [],
    targets: [
        .target(
            name: "ManifoldHub",
            dependencies: []
        ),
    ]
)
