# Multi-architecture Dockerfile for AXIS ACAP Native Application Build
# Official reference: https://developer.axis.com/acap/

ARG ARCH=aarch64
ARG SDK_VERSION=11.11.0
ARG REPO=axisecp/acap-native-sdk

FROM ${REPO}:${SDK_VERSION}-${ARCH}-ubuntu22.04 AS builder

# Set working directory
WORKDIR /opt/app

# Copy application source files
COPY . /opt/app/

# Environment setup for compilation
ENV CXXFLAGS="-O3 -Wall -Wextra -std=c++17 -D_REENTRANT"
ENV CFLAGS="-O3 -Wall -Wextra -D_REENTRANT"

# Build executable & ACAP package (.eap)
RUN make clean && make -j$(nproc)

# Output build artifacts
CMD ["sh", "-c", "echo 'ACAP Package build complete' && ls -la *.eap"]
