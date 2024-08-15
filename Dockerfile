FROM debian:bookworm-slim AS tgs-to-gif-build
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  apt update && apt-get --no-install-recommends install -y \
    python3 build-essential pkg-config cmake librlottie-dev zlib1g-dev

ADD https://github.com/p-ranav/argparse.git#v3.0 /argparse
WORKDIR /argparse/build
RUN cmake -DARGPARSE_BUILD_SAMPLES=off -DARGPARSE_BUILD_TESTS=off .. && make && make install

ADD https://github.com/ed-asriyan/lottie-converter.git#v1.1.1 /app
WORKDIR /app
RUN sed -i 's/\${CONAN_LIBS}/z/g' CMakeLists.txt && sed -i 's/include(conanbuildinfo.cmake)//g' CMakeLists.txt && sed -i 's/conan_basic_setup()//g' CMakeLists.txt

RUN cmake CMakeLists.txt && make

FROM node:18-slim

RUN mkdir -p /app/storage /app/save-files

RUN apt update && apt-get --no-install-recommends install -y \
    fonts-wqy-microhei \
    libpixman-1-0 libcairo2 libpango1.0-0 libgif7 libjpeg62-turbo libpng16-16 librsvg2-2 libvips42 librlottie0-1

WORKDIR /app
COPY --from=tgs-to-gif-build /app/tgs_to_gif /usr/local/bin/tgs_to_gif
COPY package*.json tsconfig.json ./

ENV TGS_TO_GIF=/usr/local/bin/tgs_to_gif

RUN npm install -g npm@10.7.0 && npm install

COPY . .

CMD [ "npm", "start" ]
