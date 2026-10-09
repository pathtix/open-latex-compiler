TEX = main.tex

.PHONY: all clean

all:
	latexmk -pdf $(TEX)

clean:
	latexmk -C $(TEX)
